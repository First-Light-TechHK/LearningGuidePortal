import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import nodemailer from "nodemailer";
import { atomicWriteJson, systemRoot } from "../../services/fileStore";
import {
  PASSWORD,
  SESSION_COOKIE,
  callRoute,
  clearCookies,
  getCookie,
  isolate,
  jsonRequest,
  publicShape,
  setCookie,
  takeSetCookie,
  uniqueEmail
} from "./harness";

let restore: () => Promise<void>;
let me: typeof import("../../app/api/auth/me/route");
let register: typeof import("../../app/api/auth/register/route");
let login: typeof import("../../app/api/auth/login/route");
let checkEmail: typeof import("../../app/api/auth/check-email/route");
let resend: typeof import("../../app/api/auth/resend-verification/route");
let resetRequest: typeof import("../../app/api/auth/password-reset/request/route");
let resetConfirm: typeof import("../../app/api/auth/password-reset/confirm/route");
let bindRequest: typeof import("../../app/api/auth/email-binding/request/route");
let bindConfirm: typeof import("../../app/api/auth/email-binding/confirm/route");
let google: typeof import("../../app/api/auth/google/route");
let profile: typeof import("../../app/api/me/profile/route");
let backoffice: typeof import("../../app/api/backoffice/courses/route");
let quote: typeof import("../../app/api/purchase/quote/route");
let subscriptionPortal: typeof import("../../app/api/subscription/portal/route");

before(async () => {
  restore = (await isolate("lg-io-login-")).restore;
  me = await import("../../app/api/auth/me/route");
  register = await import("../../app/api/auth/register/route");
  login = await import("../../app/api/auth/login/route");
  checkEmail = await import("../../app/api/auth/check-email/route");
  resend = await import("../../app/api/auth/resend-verification/route");
  resetRequest = await import("../../app/api/auth/password-reset/request/route");
  resetConfirm = await import("../../app/api/auth/password-reset/confirm/route");
  bindRequest = await import("../../app/api/auth/email-binding/request/route");
  bindConfirm = await import("../../app/api/auth/email-binding/confirm/route");
  google = await import("../../app/api/auth/google/route");
  profile = await import("../../app/api/me/profile/route");
  backoffice = await import("../../app/api/backoffice/courses/route");
  quote = await import("../../app/api/purchase/quote/route");
  subscriptionPortal = await import("../../app/api/subscription/portal/route");
});

after(async () => {
  await restore();
});

async function registerAccount(label: string, password = PASSWORD) {
  clearCookies();
  const email = uniqueEmail(label);
  const response = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
    email,
    password,
    nickname: "IO Learner",
    locale: "en-GB"
  }));
  takeSetCookie(response);
  return { email, response };
}

type VerificationMail = { to: string; text: string };

async function withMockVerificationMail<T>(run: (mails: VerificationMail[]) => Promise<T>) {
  const envKeys = ["EMAIL_VERIFICATION_REQUIRED", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"] as const;
  const previousEnv = envKeys.map((key) => [key, process.env[key]] as const);
  const originalTransport = nodemailer.createTransport;
  const mails: VerificationMail[] = [];
  nodemailer.createTransport = (() => ({
    sendMail: async (mail: VerificationMail) => { mails.push(mail); }
  })) as unknown as typeof nodemailer.createTransport;
  Object.assign(process.env, {
    EMAIL_VERIFICATION_REQUIRED: "1",
    SMTP_HOST: "smtp.example.test", SMTP_USER: "test", SMTP_PASS: "test-only"
  });
  try {
    return await run(mails);
  } finally {
    nodemailer.createTransport = originalTransport;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    clearCookies();
  }
}

async function registerPending(label: string, mails: VerificationMail[], password = PASSWORD) {
  const previousMailCount = mails.length;
  const { email, response } = await registerAccount(label, password);
  const body = await response.json();
  assert.equal(response.status, 200, `Pending fixture setup failed: ${body.code}`);
  assert.equal(body.ok, true);
  assert.equal(body.data.verificationRequired, true);
  assert.equal(body.data.user.email, email);
  assert.equal(body.data.user.status, "pending");
  assert.equal(body.data.user.emailVerifiedAt, null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(getCookie(SESSION_COOKIE), undefined);
  assert.equal(mails.length, previousMailCount + 1);
  assert.equal(mails[previousMailCount].to, email);
  const store = await import("../../services/productStore");
  const users = (await store.ensureProductData()).users.filter((user) => user.email === email);
  assert.equal(users.length, 1);
  assert.equal(users[0].id, body.data.user.id);
  assert.equal(users[0].status, "pending");
  assert.equal(users[0].emailVerifiedAt, null);
  return { email, userId: users[0].id };
}

test("AUTH-01 functional: check-email identifies known and unknown addresses", async () => {
  const { email } = await registerAccount("auth01-check");
  clearCookies();
  const known = await checkEmail.POST(jsonRequest("POST", "http://localhost/api/auth/check-email", { email }));
  const unknown = await checkEmail.POST(jsonRequest("POST", "http://localhost/api/auth/check-email", { email: uniqueEmail("auth01-unknown") }));
  const knownBody = await known.json() as Record<string, unknown>;
  const unknownBody = await unknown.json() as Record<string, unknown>;
  assert.equal(known.status, unknown.status);
  assert.equal(knownBody.ok, true);
  assert.equal(unknownBody.ok, true);
  assert.deepEqual((knownBody.data as Record<string, unknown>).exists, true);
  assert.deepEqual((unknownBody.data as Record<string, unknown>).exists, false);
});

test("AUTH-01 negative: registration requires a valid Unicode name", async () => {
  for (const nickname of ["", "Ada2", "Ada 😊", "Ada_"]) {
    const response = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
      email: uniqueEmail("auth01-invalid-name"), password: PASSWORD, nickname, locale: "en-GB"
    }));
    const body = await response.json() as { ok?: boolean; message?: string };
    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
  }
  const response = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
    email: uniqueEmail("auth01-unicode-name"), password: PASSWORD, nickname: "张·伟", locale: "en-GB"
  }));
  assert.equal(response.status, 200);
});

test("AUTH-01 negative: verification resend rejects the persisted daily limit", async () => {
  const store = await import("../../services/productStore");
  const user = await store.registerUser({ email: uniqueEmail("auth01-verification-limit"), password: PASSWORD, nickname: "Limit Learner" });
  const data = await store.ensureProductData();
  data.verificationTokens = Array.from({ length: 10 }, (_, index) => ({
    id: `verify-limit-${index}`, userId: user.id, tokenHash: `hash-${index}`,
    createdAt: new Date(Date.now() - (index + 2) * 61_000).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(), usedAt: null,
  }));
  await atomicWriteJson(path.join(systemRoot(), "learning_guide", "product.json"), data);
  const previousSmtp = { host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  Object.assign(process.env, { SMTP_HOST: "smtp.test", SMTP_USER: "verification@test.invalid", SMTP_PASS: "test-only" });
  try {
    const response = await resend.POST(jsonRequest("POST", "http://localhost/api/auth/resend-verification", { email: user.email, locale: "en-GB" }));
    const body = await response.json() as { ok?: boolean; code?: string };
    assert.equal(response.status, 429);
    assert.equal(body.ok, false);
    assert.equal(body.code, "VERIFICATION_DAILY_LIMIT");
  } finally {
    for (const [key, value] of Object.entries(previousSmtp)) {
      const envKey = `SMTP_${key.toUpperCase()}`;
      if (value === undefined) delete process.env[envKey]; else process.env[envKey] = value;
    }
  }
});

test("AUTH-01 negative: register copy does not say the address already exists", async () => {
  const email = uniqueEmail("auth01-register");
  const first = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
    email,
    password: PASSWORD,
    nickname: "IO Learner",
    locale: "en-GB"
  }));
  const second = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
    email,
    password: "attacker9",
    nickname: "Other Name",
    locale: "en-GB"
  }));
  const firstBody = await first.json() as Record<string, unknown>;
  const secondBody = await second.json() as Record<string, unknown>;
  assert.equal(first.status, second.status);
  assert.equal(firstBody.ok, secondBody.ok);
  assert.equal(JSON.stringify(secondBody).toLowerCase().includes("already exists"), false);
});

test("AUTH-01 negative: login does not 403 only for a pending address", async () => withMockVerificationMail(async (mails) => {
  const { email } = await registerPending("auth01-pending-login", mails);
  clearCookies();
  const pending = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", { email, password: PASSWORD }));
  const missing = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", {
    email: uniqueEmail("auth01-login-missing"),
    password: PASSWORD
  }));
  const pendingBody = await pending.json() as Record<string, unknown>;
  const missingBody = await missing.json() as Record<string, unknown>;
  assert.equal(pending.status, 401);
  assert.equal(missing.status, 401);
  assert.notEqual(pending.status, 403);
  assert.equal(pendingBody.code, missingBody.code);
  assert.deepEqual(publicShape(pendingBody), publicShape(missingBody));
  assert.equal(pending.headers.get("set-cookie"), null);
  assert.equal(missing.headers.get("set-cookie"), null);
  assert.equal((await (await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me"))).json()).user, null);
  assert.equal((await quote.POST(jsonRequest("POST", "http://localhost/api/purchase/quote", {
    planId: "everything-pc-6"
  }))).status, 401);
  assert.equal(mails.length, 1);
}));

test("AUTH-01 edge: resend enforces the documented cooldown without issuing mail, tokens or sessions", async () => withMockVerificationMail(async (mails) => {
    const { email } = await registerPending("auth01-resend", mails);
    const pending = await resend.POST(jsonRequest("POST", "http://localhost/api/auth/resend-verification", { email, locale: "en-GB" }));
    const missing = await resend.POST(jsonRequest("POST", "http://localhost/api/auth/resend-verification", {
      email: uniqueEmail("auth01-resend-missing"),
      locale: "en-GB"
    }));
    const again = await resend.POST(jsonRequest("POST", "http://localhost/api/auth/resend-verification", { email, locale: "en-GB" }));
    const pendingBody = await pending.json() as Record<string, unknown>;
    const missingBody = await missing.json() as Record<string, unknown>;
    const againBody = await again.json() as Record<string, unknown>;
    assert.equal(pending.status, 429);
    assert.equal(missing.status, 200);
    assert.equal(again.status, 429);
    assert.equal(pendingBody.code, "VERIFICATION_RATE_LIMITED");
    assert.equal(againBody.code, "VERIFICATION_RATE_LIMITED");
    for (const body of [pendingBody, againBody]) {
      const retryAfter = (body.data as { retryAfter: number }).retryAfter;
      assert.ok(retryAfter > 0 && retryAfter <= 60);
      assert.equal('token' in body, false);
      assert.equal('user' in (body.data as object), false);
    }
    assert.equal(missingBody.ok, true);
    assert.equal(mails.length, 1, "A request inside the cooldown must not send another email");
    for (const response of [pending, missing, again]) assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await (await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me"))).json()).user, null);
}));

test("AUTH-02 functional: password-reset JSON has no resetUrl or token", async () => {
  const { email } = await registerAccount("auth02-reset");
  clearCookies();
  const response = await resetRequest.POST(jsonRequest("POST", "http://localhost/api/auth/password-reset/request", {
    email,
    locale: "en-GB"
  }));
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.resetUrl, undefined);
  assert.equal(body.token, undefined);
  assert.equal(JSON.stringify(body).includes("token="), false);
});

test("AUTH-02 negative: password-reset does not reveal whether the email exists", async () => {
  const { email } = await registerAccount("auth02-enum");
  clearCookies();
  const existing = await resetRequest.POST(jsonRequest("POST", "http://localhost/api/auth/password-reset/request", { email, locale: "en-GB" }));
  const unknown = await resetRequest.POST(jsonRequest("POST", "http://localhost/api/auth/password-reset/request", {
    email: uniqueEmail("auth02-missing"),
    locale: "en-GB"
  }));
  const existingBody = await existing.json() as Record<string, unknown>;
  const unknownBody = await unknown.json() as Record<string, unknown>;
  assert.equal(existing.status, 200);
  assert.equal(unknown.status, 200);
  assert.deepEqual(publicShape(existingBody), publicShape(unknownBody));
});

test("AUTH-02 edge: sign-in without credentials is 401 and does not set a session", async () => {
  clearCookies();
  const response = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", {}));
  takeSetCookie(response);
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, "AUTHENTICATION_FAILED");
  assert.equal((await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me")).then((item) => item.json())).user, null);
});

test("AUTH-03 functional: APP_ENV=PRODUCTION does not leak a reset URL", async () => {
  const { email } = await registerAccount("auth03-reset");
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = "PRODUCTION";
  try {
    const response = await resetRequest.POST(jsonRequest("POST", "http://localhost/api/auth/password-reset/request", {
      email,
      locale: "en-GB"
    }));
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 503);
    assert.equal(body.resetUrl, undefined);
    assert.equal(JSON.stringify(body).includes("token="), false);
  } finally {
    process.env.APP_ENV = previous;
  }
});

test("AUTH-03 negative: APP_ENV=PRODUCTION does not issue a local social session", async () => {
  const previousEnv = process.env.APP_ENV;
  const previousSocial = process.env.LOCAL_SOCIAL_LOGIN;
  const previousUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.APP_ENV = "PRODUCTION";
  process.env.LOCAL_SOCIAL_LOGIN = "1";
  process.env.NEXT_PUBLIC_APP_URL = "https://localhost";
  clearCookies();
  try {
    const response = await callRoute(google.GET, jsonRequest("GET", "https://localhost/api/auth/google?locale=en-GB"));
    takeSetCookie(response);
    assert.equal(response.status, 503);
    assert.equal(getCookie(SESSION_COOKIE), undefined);
    assert.equal((await callRoute(me.GET, jsonRequest("GET", "https://localhost/api/auth/me")).then((item) => item.json())).user, null);
  } finally {
    process.env.APP_ENV = previousEnv;
    process.env.LOCAL_SOCIAL_LOGIN = previousSocial;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousUrl;
  }
});

test("AUTH-03 edge: APP_ENV=DEV still allows a local password-reset request without a token leak", async () => {
  process.env.APP_ENV = "DEV";
  const response = await resetRequest.POST(jsonRequest("POST", "http://localhost/api/auth/password-reset/request", {
    email: uniqueEmail("auth03-dev"),
    locale: "en-GB"
  }));
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.resetUrl, undefined);
});

test("AUTH-04 functional: registering the operator email stays a student", async () => {
  const email = uniqueEmail("auth04-ops");
  process.env.BACKOFFICE_OPERATOR_EMAIL = email;
  try {
    const response = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
      email,
      password: PASSWORD,
      nickname: "IO Learner",
      locale: "en-GB"
    }));
    takeSetCookie(response);
    assert.equal(response.status, 200);
    const mine = await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me"));
    const body = await mine.json();
    assert.equal(body.user.role, "student");
    const office = await callRoute(backoffice.GET, jsonRequest("GET", "http://localhost/api/backoffice/courses"));
    assert.equal(office.status, 403);
  } finally {
    delete process.env.BACKOFFICE_OPERATOR_EMAIL;
  }
});

test("AUTH-04 negative: matching the operator email later does not open backoffice", async () => {
  const { email } = await registerAccount("auth04-live");
  process.env.BACKOFFICE_OPERATOR_EMAIL = email;
  try {
    const office = await callRoute(backoffice.GET, jsonRequest("GET", "http://localhost/api/backoffice/courses"));
    assert.equal(office.status, 403);
    const mine = await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me"));
    assert.equal((await mine.json()).user.role, "student");
  } finally {
    delete process.env.BACKOFFICE_OPERATOR_EMAIL;
  }
});

test("AUTH-04 edge: unauthenticated backoffice is 403", async () => {
  clearCookies();
  const response = await callRoute(backoffice.GET, jsonRequest("GET", "http://localhost/api/backoffice/courses"));
  assert.equal(response.status, 403);
});

test("AUTH-05 functional: a second register does not take over the first password", async () => {
  const email = uniqueEmail("auth05-owner");
  const first = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
    email,
    password: PASSWORD,
    nickname: "First Owner",
    locale: "en-GB"
  }));
  assert.equal(first.status, 200);
  clearCookies();
  const second = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
    email,
    password: "attacker9",
    nickname: "Attacker",
    locale: "en-GB"
  }));
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("set-cookie"), null);
  assert.equal(JSON.stringify(await second.json()).toLowerCase().includes("already exists"), false);
  clearCookies();
  const owner = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", { email, password: PASSWORD }));
  takeSetCookie(owner);
  assert.equal(owner.status, 200);
  assert.equal((await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me")).then((item) => item.json())).user.email, email);
  clearCookies();
  const attacker = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", { email, password: "attacker9" }));
  takeSetCookie(attacker);
  assert.equal(attacker.status, 401);
  assert.equal((await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me")).then((item) => item.json())).user, null);
});

test("AUTH-05 edge: concurrent same-email register keeps one working password", async (t) => {
  for (const count of [2, 3]) {
    await t.test(`${count} parallel registrations`, async () => {
      clearCookies();
      const email = uniqueEmail("auth05-race");
      const attempts = [
        { password: "password1", nickname: "First Owner" },
        { password: "attacker9", nickname: "Second Owner" },
        { password: "password3", nickname: "Third Owner" }
      ].slice(0, count);
      const responses = await Promise.all(attempts.map((attempt, index) =>
        register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
          ...attempt,
          email: index % 2 ? ` ${email.toUpperCase()} ` : email,
          locale: "en-GB"
        }))
      ));
      for (const response of responses) {
        const body = await response.json();
        assert.equal(response.status, 200, `Concurrent registration failed: ${body.code}`);
        assert.equal(body.ok, true);
      }
      const ownerIndex = responses.findIndex((response) => response.headers.has("set-cookie"));
      assert.equal(responses.filter((response) => response.headers.has("set-cookie")).length, 1,
        "Only the registration that creates the account may receive a session");
      for (const [index, attempt] of attempts.entries()) {
        clearCookies();
        const response = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", {
          email, password: attempt.password
        }));
        assert.equal(response.status, index === ownerIndex ? 200 : 401);
        takeSetCookie(response);
        const mine = await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me"));
        const { user } = await mine.json();
        if (index === ownerIndex) {
          assert.equal(user.email, email);
          assert.equal(user.nickname, attempt.nickname);
          assert.equal(user.role, "student");
        } else {
          assert.equal(response.headers.get("set-cookie"), null);
          assert.equal(user, null);
          assert.equal((await quote.POST(jsonRequest("POST", "http://localhost/api/purchase/quote", {
            planId: "everything-pc-6"
          }))).status, 401);
        }
      }
    });
  }
});

test("AUTH-05 edge: pending duplicates cannot replace verification or create sessions", async () => withMockVerificationMail(async (mails) => {
    clearCookies();
    const email = uniqueEmail("auth05-pending-race");
    const attempts = [
      { password: "password1", nickname: "First Owner" },
      { password: "attacker9", nickname: "Second Owner" },
      { password: "password3", nickname: "Third Owner" }
    ];
    const responses = await Promise.all(attempts.map((attempt) =>
      register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
        ...attempt, email, locale: "en-GB"
      }))
    ));
    for (const response of responses) {
      const body = await response.json();
      assert.equal(response.status, 200, `Pending registration failed: ${body.code}`);
      assert.equal(body.ok, true);
      assert.equal(body.data.verificationRequired, true);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(body.token, undefined);
    }
    assert.equal(mails.length, 1, "Only the creator sends the initial verification email (mocked)");
    assert.equal(mails[0].to, email);
    for (const attempt of attempts) {
      const response = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", {
        email, password: attempt.password
      }));
      assert.equal(response.status, 401, "Pending accounts cannot sign in with any competing password");
      assert.equal(response.headers.get("set-cookie"), null);
    }
    assert.equal((await (await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me"))).json()).user, null);

    // Even after the initial cooldown, registering again must not rotate the owner's token.
    const store = await import("../../services/productStore");
    const data = await store.ensureProductData();
    const users = data.users.filter((user) => user.email === email);
    assert.equal(users.length, 1);
    const owner = users[0];
    for (const token of data.verificationTokens.filter((token) => token.userId === owner.id)) {
      token.createdAt = new Date(Date.now() - 61_000).toISOString();
    }
    await atomicWriteJson(path.join(systemRoot(), "learning_guide", "product.json"), data);
    const repeated = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
      email, password: "takeover9", nickname: "Another Owner", locale: "en-GB"
    }));
    assert.equal(repeated.status, 200);
    assert.equal(repeated.headers.get("set-cookie"), null);
    assert.equal(mails.length, 1, "Registration is not an implicit resend");

    const link = mails[0].text.match(/https?:\/\/\S+/)?.[0];
    assert.ok(link);
    const token = new URL(link).searchParams.get("token");
    assert.ok(token);
    const verify = await import("../../app/api/auth/verify-email/route");
    assert.equal((await verify.POST(jsonRequest("POST", "http://localhost/api/auth/verify-email", { token }))).status, 200);
    assert.equal((await verify.POST(jsonRequest("POST", "http://localhost/api/auth/verify-email", { token }))).status, 400,
      "The original verification token remains single-use");
    for (const attempt of [...attempts, { password: "takeover9", nickname: "Another Owner" }]) {
      clearCookies();
      const response = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", {
        email, password: attempt.password
      }));
      assert.equal(response.status, attempt.nickname === owner.nickname ? 200 : 401);
    }
}));

test("AUTH-05 negative: duplicate pending registration preserves its token when SMTP fails", async () => withMockVerificationMail(async (mails) => {
  const { email, userId } = await registerPending("auth05-pending-mail-failure", mails);
  const store = await import("../../services/productStore");
  const data = await store.ensureProductData();
  const originalTokens = data.verificationTokens.filter((token) => token.userId === userId);
  assert.equal(originalTokens.length, 1);
  originalTokens[0].createdAt = new Date(Date.now() - 61_000).toISOString();
  await atomicWriteJson(path.join(systemRoot(), "learning_guide", "product.json"), data);
  nodemailer.createTransport = () => { throw new Error("Simulated SMTP outage"); };

  const response = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
    email, password: "attacker9", nickname: "Other Owner", locale: "en-GB"
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(publicShape(await response.json()), { ok: true, data: { verificationRequired: true } });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(mails.length, 1);
  const after = await store.ensureProductData();
  assert.deepEqual(after.verificationTokens.filter((token) => token.userId === userId), originalTokens);
  assert.deepEqual(after.users.filter((user) => user.email === email), data.users.filter((user) => user.email === email));
}));

test("AUTH-05 negative: verification required without mail delivery is 503", async () => {
  process.env.EMAIL_VERIFICATION_REQUIRED = "1";
  process.env.EMAIL_DELIVERY = "";
  delete process.env.SES_FROM_EMAIL;
  try {
    const response = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
      email: uniqueEmail("auth05-verify"),
      password: PASSWORD,
      locale: "en-GB"
    }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "EMAIL_DELIVERY_NOT_CONFIGURED");
  } finally {
    process.env.EMAIL_VERIFICATION_REQUIRED = "0";
  }
});

test("AUTH-06 functional: a second sign-in invalidates the first session", async () => {
  const { email } = await registerAccount("auth06-kick");
  const firstToken = getCookie(SESSION_COOKIE);
  assert.ok(firstToken);
  clearCookies();
  const signedIn = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", { email, password: PASSWORD }));
  takeSetCookie(signedIn);
  const secondToken = getCookie(SESSION_COOKIE);
  assert.ok(secondToken);
  assert.notEqual(firstToken, secondToken);
  setCookie(SESSION_COOKIE, firstToken);
  assert.equal((await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me")).then((item) => item.json())).user, null);
  setCookie(SESSION_COOKIE, secondToken);
  assert.equal((await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me")).then((item) => item.json())).user.email, email);
});

test("AUTH-06 negative: changing password invalidates the previous session", async () => {
  await registerAccount("auth06-password");
  const changed = await profile.PATCH(jsonRequest("PATCH", "http://localhost/api/me/profile", {
    nickname: "IO Learner",
    locale: "en-GB",
    currentPassword: PASSWORD,
    newPassword: "Passw0rd!999"
  }));
  assert.equal(changed.status, 200);
  assert.equal((await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me")).then((item) => item.json())).user, null);
  const gated = await quote.POST(jsonRequest("POST", "http://localhost/api/purchase/quote", { planId: "everything-pc-6" }));
  assert.equal(gated.status, 401);
});

test("AUTH-06 edge: a forged session cookie does not restore a user", async () => {
  clearCookies();
  setCookie(SESSION_COOKIE, "forged-session-token");
  const response = await callRoute(me.GET, jsonRequest("GET", "http://localhost/api/auth/me"));
  assert.equal((await response.json()).user, null);
  const gated = await quote.POST(jsonRequest("POST", "http://localhost/api/purchase/quote", { planId: "everything-pc-6" }));
  assert.equal(gated.status, 401);
});

test("AUTH-02 edge: confirm without a token or with a garbage token leaks nothing", async () => {
  const missing = await resetConfirm.POST(jsonRequest("POST", "http://localhost/api/auth/password-reset/confirm", {}));
  const garbage = await resetConfirm.POST(jsonRequest("POST", "http://localhost/api/auth/password-reset/confirm", {
    token: "garbage-reset-token",
    newPassword: "Passw0rd!999"
  }));
  const missingBody = await missing.json() as Record<string, unknown>;
  const garbageBody = await garbage.json() as Record<string, unknown>;
  assert.equal(missing.status, 400);
  assert.equal(garbage.status, 400);
  assert.equal(missingBody.ok, false);
  assert.equal(garbageBody.ok, false);
  assert.equal(missingBody.resetUrl, undefined);
  assert.equal(garbageBody.resetUrl, undefined);
  assert.equal(JSON.stringify(missingBody).includes("token="), false);
  assert.equal(JSON.stringify(garbageBody).includes("token="), false);
});

test("AUTH-06 / WeChat bind: email-binding request without a session is 401 and grants nothing", async () => {
  clearCookies();
  const response = await bindRequest.POST(jsonRequest("POST", "http://localhost/api/auth/email-binding/request", {
    email: uniqueEmail("bind-unauth"),
    locale: "en-GB"
  }));
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.equal("token" in body, false);
  assert.equal(body.bindUrl, undefined);
  assert.equal(JSON.stringify(body).includes("token="), false);
});

test("AUTH-02 edge: signed-in email-binding request JSON has no token", async () => {
  await registerAccount("bind-req");
  const response = await bindRequest.POST(jsonRequest("POST", "http://localhost/api/auth/email-binding/request", {
    email: uniqueEmail("bind-target"),
    locale: "en-GB"
  }));
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.token, undefined);
  assert.equal(body.bindUrl, undefined);
  assert.equal(JSON.stringify(body).includes("token="), false);
});

test("AUTH-02 edge: email-binding confirm without a token or with a garbage token leaks nothing", async () => {
  const missing = await bindConfirm.POST(jsonRequest("POST", "http://localhost/api/auth/email-binding/confirm", {}));
  const garbage = await bindConfirm.POST(jsonRequest("POST", "http://localhost/api/auth/email-binding/confirm", {
    token: "garbage-bind-token"
  }));
  const missingBody = await missing.json() as Record<string, unknown>;
  const garbageBody = await garbage.json() as Record<string, unknown>;
  assert.equal(missing.status, 400);
  assert.equal(garbage.status, 400);
  assert.equal(missingBody.ok, false);
  assert.equal(garbageBody.ok, false);
  assert.equal("token" in missingBody, false);
  assert.equal("token" in garbageBody, false);
  assert.equal(JSON.stringify(missingBody).includes("token="), false);
  assert.equal(JSON.stringify(garbageBody).includes("token="), false);
});

test("AUTH-06 edge: subscription portal without a session is 401", async () => {
  clearCookies();
  const response = await subscriptionPortal.POST(jsonRequest("POST", "http://localhost/api/subscription/portal", {
    locale: "en-GB",
    action: "manage"
  }));
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.equal(body.url, undefined);
});
