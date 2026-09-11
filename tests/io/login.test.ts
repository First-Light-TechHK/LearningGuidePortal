import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  PASSWORD,
  SESSION_COOKIE,
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
let google: typeof import("../../app/api/auth/google/route");
let profile: typeof import("../../app/api/me/profile/route");
let backoffice: typeof import("../../app/api/backoffice/courses/route");
let quote: typeof import("../../app/api/purchase/quote/route");

before(async () => {
  restore = (await isolate("lg-io-login-")).restore;
  me = await import("../../app/api/auth/me/route");
  register = await import("../../app/api/auth/register/route");
  login = await import("../../app/api/auth/login/route");
  checkEmail = await import("../../app/api/auth/check-email/route");
  resend = await import("../../app/api/auth/resend-verification/route");
  resetRequest = await import("../../app/api/auth/password-reset/request/route");
  google = await import("../../app/api/auth/google/route");
  profile = await import("../../app/api/me/profile/route");
  backoffice = await import("../../app/api/backoffice/courses/route");
  quote = await import("../../app/api/purchase/quote/route");
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

async function registerPending(label: string, password = PASSWORD) {
  const previousVerification = process.env.EMAIL_VERIFICATION_REQUIRED;
  const previousDelivery = process.env.EMAIL_DELIVERY;
  process.env.EMAIL_VERIFICATION_REQUIRED = "1";
  process.env.EMAIL_DELIVERY = "discard";
  try {
    return await registerAccount(label, password);
  } finally {
    process.env.EMAIL_VERIFICATION_REQUIRED = previousVerification;
    process.env.EMAIL_DELIVERY = previousDelivery;
  }
}

test("AUTH-01 functional: check-email does not distinguish a known address from an unknown one", async () => {
  const { email } = await registerAccount("auth01-check");
  clearCookies();
  const known = await checkEmail.POST(jsonRequest("POST", "http://localhost/api/auth/check-email", { email }));
  const unknown = await checkEmail.POST(jsonRequest("POST", "http://localhost/api/auth/check-email", { email: uniqueEmail("auth01-unknown") }));
  const knownBody = await known.json() as Record<string, unknown>;
  const unknownBody = await unknown.json() as Record<string, unknown>;
  assert.equal(known.status, unknown.status);
  assert.equal("exists" in knownBody, false);
  assert.equal("exists" in unknownBody, false);
  assert.deepEqual(publicShape(knownBody), publicShape(unknownBody));
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

test("AUTH-01 negative: login does not 403 only for a pending address", async () => {
  const { email } = await registerPending("auth01-pending-login");
  clearCookies();
  const pending = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", { email, password: PASSWORD }));
  const missing = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", {
    email: uniqueEmail("auth01-login-missing"),
    password: PASSWORD
  }));
  const pendingBody = await pending.json() as Record<string, unknown>;
  const missingBody = await missing.json() as Record<string, unknown>;
  assert.equal(pending.status, missing.status);
  assert.notEqual(pending.status, 403);
  assert.equal(pendingBody.code, missingBody.code);
  assert.deepEqual(publicShape(pendingBody), publicShape(missingBody));
});

test("AUTH-01 edge: resend-verification does not 429 only for a pending address", async () => {
  const { email } = await registerPending("auth01-resend");
  process.env.EMAIL_DELIVERY = "discard";
  try {
    const pending = await resend.POST(jsonRequest("POST", "http://localhost/api/auth/resend-verification", { email, locale: "en-GB" }));
    const missing = await resend.POST(jsonRequest("POST", "http://localhost/api/auth/resend-verification", {
      email: uniqueEmail("auth01-resend-missing"),
      locale: "en-GB"
    }));
    const again = await resend.POST(jsonRequest("POST", "http://localhost/api/auth/resend-verification", { email, locale: "en-GB" }));
    const pendingBody = await pending.json() as Record<string, unknown>;
    const missingBody = await missing.json() as Record<string, unknown>;
    const againBody = await again.json() as Record<string, unknown>;
    assert.equal(pending.status, missing.status);
    assert.equal(again.status, missing.status);
    assert.notEqual(pending.status, 429);
    assert.deepEqual(publicShape(pendingBody), publicShape(missingBody));
    assert.deepEqual(publicShape(againBody), publicShape(missingBody));
  } finally {
    process.env.EMAIL_DELIVERY = "";
  }
});

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
  assert.equal((await me.GET(jsonRequest("GET", "http://localhost/api/auth/me")).then((item) => item.json())).user, null);
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
    const response = await google.GET(jsonRequest("GET", "https://localhost/api/auth/google?locale=en-GB"));
    takeSetCookie(response);
    assert.equal(response.status, 503);
    assert.equal(getCookie(SESSION_COOKIE), undefined);
    assert.equal((await me.GET(jsonRequest("GET", "https://localhost/api/auth/me")).then((item) => item.json())).user, null);
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
    const mine = await me.GET(jsonRequest("GET", "http://localhost/api/auth/me"));
    const body = await mine.json();
    assert.equal(body.user.role, "student");
    const office = await backoffice.GET(jsonRequest("GET", "http://localhost/api/backoffice/courses"));
    assert.equal(office.status, 403);
  } finally {
    delete process.env.BACKOFFICE_OPERATOR_EMAIL;
  }
});

test("AUTH-04 negative: matching the operator email later does not open backoffice", async () => {
  const { email } = await registerAccount("auth04-live");
  process.env.BACKOFFICE_OPERATOR_EMAIL = email;
  try {
    const office = await backoffice.GET(jsonRequest("GET", "http://localhost/api/backoffice/courses"));
    assert.equal(office.status, 403);
    const mine = await me.GET(jsonRequest("GET", "http://localhost/api/auth/me"));
    assert.equal((await mine.json()).user.role, "student");
  } finally {
    delete process.env.BACKOFFICE_OPERATOR_EMAIL;
  }
});

test("AUTH-04 edge: unauthenticated backoffice is 403", async () => {
  clearCookies();
  const response = await backoffice.GET(jsonRequest("GET", "http://localhost/api/backoffice/courses"));
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
  const second = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
    email,
    password: "attacker9",
    nickname: "Attacker",
    locale: "en-GB"
  }));
  assert.equal(second.status, 200);
  assert.equal(JSON.stringify(await second.json()).toLowerCase().includes("already exists"), false);
  clearCookies();
  const owner = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", { email, password: PASSWORD }));
  takeSetCookie(owner);
  assert.equal(owner.status, 200);
  assert.equal((await me.GET(jsonRequest("GET", "http://localhost/api/auth/me")).then((item) => item.json())).user.email, email);
  clearCookies();
  const attacker = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", { email, password: "attacker9" }));
  takeSetCookie(attacker);
  assert.equal(attacker.status, 401);
  assert.equal((await me.GET(jsonRequest("GET", "http://localhost/api/auth/me")).then((item) => item.json())).user, null);
});

test("AUTH-05 edge: concurrent same-email register keeps one working password", async () => {
  const email = uniqueEmail("auth05-race");
  const [first, second] = await Promise.all([
    register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
      email,
      password: "password1",
      nickname: "First Owner",
      locale: "en-GB"
    })),
    register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
      email,
      password: "attacker9",
      nickname: "Attacker",
      locale: "en-GB"
    }))
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  clearCookies();
  const firstLogin = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", { email, password: "password1" }));
  const secondLogin = await login.POST(jsonRequest("POST", "http://localhost/api/auth/sign-in", { email, password: "attacker9" }));
  const wins = [firstLogin.status, secondLogin.status].filter((status) => status === 200);
  assert.equal(wins.length, 1);
});

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
  assert.equal((await me.GET(jsonRequest("GET", "http://localhost/api/auth/me")).then((item) => item.json())).user, null);
  setCookie(SESSION_COOKIE, secondToken);
  assert.equal((await me.GET(jsonRequest("GET", "http://localhost/api/auth/me")).then((item) => item.json())).user.email, email);
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
  assert.equal((await me.GET(jsonRequest("GET", "http://localhost/api/auth/me")).then((item) => item.json())).user, null);
  const gated = await quote.POST(jsonRequest("POST", "http://localhost/api/purchase/quote", { planId: "everything-pc-6" }));
  assert.equal(gated.status, 401);
});

test("AUTH-06 edge: a forged session cookie does not restore a user", async () => {
  clearCookies();
  setCookie(SESSION_COOKIE, "forged-session-token");
  const response = await me.GET(jsonRequest("GET", "http://localhost/api/auth/me"));
  assert.equal((await response.json()).user, null);
  const gated = await quote.POST(jsonRequest("POST", "http://localhost/api/purchase/quote", { planId: "everything-pc-6" }));
  assert.equal(gated.status, 401);
});
