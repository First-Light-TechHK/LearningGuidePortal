function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function redact(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "(invalid-url)";
  }
}

async function read(response) {
  const text = await response.text();
  try { return { status: response.status, url: response.url, headers: response.headers, body: JSON.parse(text), text }; }
  catch { return { status: response.status, url: response.url, headers: response.headers, body: null, text }; }
}

export function createLiveClient(origin, fetchImpl = fetch) {
  return async function request(path, options = {}) {
    const response = await fetchImpl(new URL(path, origin), {
      redirect: options.redirect || "follow",
      method: options.method || "GET",
      headers: options.headers,
      body: options.body
    });
    return read(response);
  };
}

function fail(failures, name, detail) {
  failures.push(`${name}: ${detail}`);
}

function awsErrorLeak(payload) {
  return /ses:SendEmail|assumed-role|not authorized to perform/i.test(JSON.stringify(payload || {}));
}

async function postJson(http, path, body) {
  return http(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function runLiveSmoke(input, request) {
  const { origin, adminOrigin, appEnv, sha, requireDependencyChecks, requireVersionMatch } = input;
  const http = request || createLiveClient(origin);
  const adminHttp = adminOrigin ? (request || createLiveClient(adminOrigin)) : null;
  const failures = [];
  const json = { "content-type": "application/json" };

  const health = await http("/api/health");
  if (health.status !== 200 || health.body?.ready !== true) fail(failures, "health", `HTTP ${health.status} ready=${health.body?.ready}`);
  const expectedEnvs = appEnv === "PPE/PROD" || appEnv === "PPE" ? ["PPE/PROD", "PROD", "PPE"] : [appEnv];
  if (health.body && !expectedEnvs.includes(health.body.environment)) fail(failures, "health.environment", String(health.body.environment));
  if (requireVersionMatch && sha && health.body?.version !== sha) fail(failures, "health.version", String(health.body?.version));
  if (requireDependencyChecks) {
    const checks = health.body?.checks || {};
    for (const name of ["database", "paymentMigration", "storage"]) {
      if (checks[name] !== true) fail(failures, `health.checks.${name}`, String(checks[name]));
    }
  }

  const config = await http("/api/health/config");
  if (config.status !== 200 || config.body?.ready !== true) fail(failures, "config", `HTTP ${config.status} ready=${config.body?.ready}`);
  if (Array.isArray(config.body?.missing) && config.body.missing.length) fail(failures, "config.missing", config.body.missing.join(","));
  if (config.body?.storage !== "postgresql+s3") fail(failures, "config.storage", String(config.body?.storage));
  if (["SIT", "UAT", "PPE", "PPE/PROD", "PROD"].includes(appEnv) && config.body?.payment?.mode !== "stripe") {
    fail(failures, "config.payment", String(config.body?.payment?.mode));
  }

  for (const path of ["/en-GB/portal", "/zh-CN/portal", "/en-GB/portal/courses", "/en-GB/portal/sign-in", "/zh-CN/portal/sign-in", "/en-GB/pricing"]) {
    const page = await http(path);
    if (page.status !== 200) fail(failures, path, `HTTP ${page.status}`);
    else if (/Application error|Internal Server Error/i.test(page.text || "")) fail(failures, path, "rendered an application error");
  }

  const courses = await http("/api/portal/courses");
  const list = courses.body?.courses || [];
  if (courses.status !== 200 || !list.length) fail(failures, "catalogue", `HTTP ${courses.status} count=${list.length}`);
  const published = list.filter((course) => !course.status || course.status === "published");
  if (!published.length) fail(failures, "catalogue.published", "no published course");
  const slug = published[0]?.slug || published[0]?.id;
  if (slug) {
    const course = await http(`/api/portal/courses/${slug}`);
    if (course.status !== 200 || !course.body?.page) fail(failures, "course.api", `HTTP ${course.status}`);
    const html = await http(`/en-GB/portal/courses/${slug}`);
    if (html.status !== 200) fail(failures, "course.page", `HTTP ${html.status}`);
  }

  const plans = await http("/api/portal/plans");
  if (plans.status !== 200 || !(plans.body?.plans || []).length) fail(failures, "plans", `HTTP ${plans.status}`);

  const me = await http("/api/my-learning");
  if (me.status !== 401) fail(failures, "my-learning.unauthenticated", `HTTP ${me.status}`);

  const study = await http("/api/study/events", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ courseId: slug || "epicureanism", lessonId: "public", event: "complete", seconds: 1, clientEventId: `live-${Date.now()}` })
  });
  if (study.status === 200) fail(failures, "study.events", "unauthenticated write returned 200");

  const checkEmail = await http("/api/auth/check-email", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: "live-smoke@example.test" })
  });
  if (checkEmail.status !== 200 || checkEmail.body?.ok !== true) fail(failures, "check-email", `HTTP ${checkEmail.status}`);

  const testEmail = input.testEmail?.trim().toLowerCase();
  if (["SIT", "UAT", "PPE", "PPE/PROD", "PROD"].includes(appEnv) && !testEmail) {
    fail(failures, "registration", "LIVE_TEST_EMAIL is required so registration is actually mailed");
  } else if (testEmail) {
    const registered = await postJson(http, "/api/auth/register", {
      email: testEmail,
      password: "SitSmoke-Passw0rd!",
      nickname: "SIT smoke",
      locale: "en-GB"
    });
    if (awsErrorLeak(registered.body)) fail(failures, "registration", "response leaked an AWS IAM error");
    if (registered.status !== 200 || registered.body?.ok !== true) {
      fail(failures, "registration", `HTTP ${registered.status} ${registered.body?.code || registered.body?.message || ""}`.trim());
    } else if (registered.body?.data?.verificationRequired) {
      const login = await postJson(http, "/api/auth/login", { email: testEmail, password: "SitSmoke-Passw0rd!" });
      if (login.status === 200) fail(failures, "registration.pending", "unverified account received a session");
    } else {
      const resend = await postJson(http, "/api/auth/resend-verification", { email: testEmail, locale: "en-GB" });
      if (awsErrorLeak(resend.body)) fail(failures, "registration.resend", "response leaked an AWS IAM error");
      if (resend.status !== 200 || resend.body?.ok !== true) {
        fail(failures, "registration.resend", `HTTP ${resend.status} ${resend.body?.code || resend.body?.message || ""}`.trim());
      }
      const reset = await postJson(http, "/api/auth/password-reset/request", { email: testEmail, locale: "en-GB" });
      if (reset.status === 503 || reset.body?.code === "email_unavailable") {
        fail(failures, "registration.mail", "password reset could not send mail");
      }
    }

    const probe = await postJson(http, "/api/auth/resend-verification", {
      email: "sit-ses-probe@example.test",
      locale: "en-GB"
    });
    if (awsErrorLeak(probe.body)) fail(failures, "registration.iam", "SES IAM still denies the recipient identity");
    const probeRegister = await postJson(http, "/api/auth/register", {
      email: "sit-ses-probe@example.test",
      password: "SitSmoke-Passw0rd!",
      nickname: "SES probe",
      locale: "en-GB"
    });
    if (awsErrorLeak(probeRegister.body)) fail(failures, "registration.iam", "SES IAM still denies the recipient identity");
  }

  const google = await http("/api/auth/google?locale=en-GB", { redirect: "manual" });
  const googleLocation = google.headers?.get?.("location") || "";
  if (!googleLocation) fail(failures, "google.redirect", `HTTP ${google.status} no Location`);
  else if (hostOf(googleLocation) !== "accounts.google.com") fail(failures, "google.redirect", redact(googleLocation));

  const wechat = await http("/api/auth/wechat?locale=en-GB", { redirect: "manual" });
  const wechatLocation = wechat.headers?.get?.("location") || "";
  if (!wechatLocation) fail(failures, "wechat.redirect", `HTTP ${wechat.status} no Location`);
  else if (hostOf(wechatLocation) !== "open.weixin.qq.com") fail(failures, "wechat.redirect", redact(wechatLocation));

  const learnerBackoffice = await http("/en-GB/backoffice");
  if (learnerBackoffice.status !== 404) fail(failures, "learner.backoffice", `HTTP ${learnerBackoffice.status}`);

  if (adminOrigin && adminHttp) {
    const admin = await adminHttp("/en-GB/backoffice", { redirect: "manual" });
    if (admin.status === 404) fail(failures, "admin.backoffice", "admin host returned 404");
    else if (![200, 302, 303, 307, 308].includes(admin.status)) fail(failures, "admin.backoffice", `HTTP ${admin.status}`);
  }

  return { ok: failures.length === 0, failures, catalogue: published.map((course) => course.slug || course.id) };
}
