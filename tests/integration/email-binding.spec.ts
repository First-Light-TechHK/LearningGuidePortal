import { expect, test } from "playwright/test";
import "./helpers/preload-native-modules";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "os";
import path from "path";
import nodemailer from "nodemailer";
import { POST as requestEmailBinding } from "../../app/api/auth/email-binding/request/route";
import { POST as confirmEmailBinding } from "../../app/api/auth/email-binding/confirm/route";

async function withBindingStore(run: (store: typeof import("../../services/productStore"), directory: string, mails: Array<{ text: string }>) => Promise<void>) {
  const cwd = process.cwd(), env = { ...process.env }, transport = nodemailer.createTransport;
  const directory = await mkdtemp(path.join(tmpdir(), "learning-guide-link-")), mails: Array<{ text: string }> = [];
  nodemailer.createTransport = (() => ({ sendMail: async (mail: { text: string }) => { mails.push(mail); } })) as unknown as typeof nodemailer.createTransport;
  process.chdir(directory);
  Object.assign(process.env, { APP_ENV: "DEV", STORAGE_BACKEND: "local", PAYMENT_MODE: "demo", SMTP_HOST: "smtp.example.test", SMTP_USER: "fake", SMTP_PASS: "fake", NEXT_PUBLIC_APP_URL: "https://binding.example.test" });
  try { await run(await import("../../services/productStore"), directory, mails); }
  finally {
    nodemailer.createTransport = transport; process.chdir(cwd); process.env = env;
    if (path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
  }
}

const bindingRequest = (body: object, cookie = "") => new Request("https://binding.example.test/api/auth/email-binding/confirm", { method: "POST", headers: { cookie, origin: "https://binding.example.test" }, body: JSON.stringify(body) });

test("independent assessment, group and helpdesk history prevents source retirement", async () => withBindingStore(async (store, directory) => {
  const target = await store.getOrCreateSocialUser({ provider: "google", providerSubject: "history-google", email: "history@example.test" });
  for (const kind of ["assessment", "group", "helpdesk"]) {
    const source = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: `history-${kind}` });
    const token = await store.issueEmailBinding(source.id, target.email!);
    const root = path.join(directory, "data", "knowledge_system");
    const courseId = (await store.ensureProductData()).courses[0].id;
    const key = createHash("sha256").update(JSON.stringify([source.id, courseId])).digest("hex");
    const file = kind === "assessment" ? path.join(root, "lesson_assessments", `${key}.json`) : kind === "group" ? path.join(root, "learning_guide", "study-group", "study-group.json") : path.join(root, "helpdesk", "store.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(kind === "assessment" ? [{ record: { lessonId: "saved-lesson" } }] : kind === "group" ? { memberships: [{ userId: source.id }] } : { assists: [{ learnerId: source.id }] }));
    await expect(store.confirmEmailBinding(token.token, { confirmed: true })).rejects.toThrow("source_has_history");
    expect((await store.getUserById(source.id))?.status).toBe("active");
  }
}));

test("two competing WeChat identities cannot both attach to the same target", async () => withBindingStore(async store => {
  const target = await store.getOrCreateSocialUser({ provider: "google", providerSubject: "competing-google", email: "competing@example.test" });
  const sources = await Promise.all(["one", "two"].map(providerSubject => store.getOrCreateSocialUser({ provider: "wechat", providerSubject })));
  const tokens = await Promise.all(sources.map(source => store.issueEmailBinding(source.id, target.email!)));
  const results = await Promise.allSettled(tokens.map(token => store.confirmEmailBinding(token.token, { confirmed: true })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const rejection = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  expect(rejection.reason.message).toBe("account_conflict");
  expect((await store.ensureProductData()).accounts.filter(account => account.userId === target.id && account.provider === "wechat")).toHaveLength(1);
}));

for (const provider of ["email", "google"] as const) {
  test(`WeChat links to an existing ${provider} user, preserves business data and rotates only the source session`, async () => withBindingStore(async (store, directory, mails) => {
    const target = provider === "google"
      ? await store.getOrCreateSocialUser({ provider: "google", providerSubject: "existing-google", email: "existing@example.test" })
      : await store.registerUser({ email: "existing@example.test", password: "Original-password-123" });
    if (!target.emailVerifiedAt) await store.verifyEmailToken(await store.issueEmailVerificationToken(target.id));
    await store.activateTrial(target.id, "epicureanism");
    const course = (await store.ensureProductData()).courses.find(item => item.id === "epicureanism")!;
    await store.recordStudyEvent({ userId: target.id, courseId: course.id, lessonId: course.sections[0].lessons[0].id, event: "open", seconds: 0, clientEventId: "existing-study" });
    const before = await store.ensureProductData();
    const targetSession = await store.createSession(target.id);
    const source = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "wx-app:openid", wechat: { appId: "wx-app", openId: "openid", unionId: "union" } });
    const sourceSession = await store.createSession(source.id), oldSession = await store.createSession(source.id);
    const cookie = `learning_guide_session=${sourceSession.token}`;
    const request = await requestEmailBinding(new Request("https://binding.example.test/api/auth/email-binding/request", { method: "POST", headers: { cookie, origin: "https://binding.example.test" }, body: JSON.stringify({ email: " EXISTING@EXAMPLE.TEST ", locale: "zh-CN" }) }));
    expect(request.status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain("保留原有订阅和学习记录");
    const token = new URL(mails[0].text.match(/https[^\s]+/)![0]).searchParams.get("token")!;
    const body = { token, confirmed: true, locale: "zh-CN", returnTo: "/zh-CN/subscription?term=6#plans", targetUserId: "forged", accountId: "forged" };
    expect((await confirmEmailBinding(bindingRequest({ ...body, confirmed: false }, cookie))).status).toBe(400);
    expect((await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "wx-app:openid" })).id).toBe(source.id);
    const success = await confirmEmailBinding(bindingRequest(body, cookie));
    expect(await success.json()).toMatchObject({ ok: true, merged: true, sameUser: true, continueUrl: body.returnTo });
    expect(success.headers.get("cache-control")).toContain("no-store");
    const session = success.cookies.get("learning_guide_session");
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
    expect((await store.getUserBySessionToken(session!.value))?.id).toBe(target.id);
    expect(await store.getUserBySessionToken(sourceSession.token, true)).toBeNull();
    expect(await store.getUserBySessionToken(oldSession.token, true)).toBeNull();
    expect((await store.getUserBySessionToken(targetSession.token))?.id).toBe(target.id);
    const after = await store.ensureProductData();
    expect(after.users.find(item => item.id === source.id)).toMatchObject({ status: "disabled", mergedIntoUserId: target.id });
    expect(after.users.find(item => item.id === target.id)).toEqual(before.users.find(item => item.id === target.id));
    for (const field of ["orders", "subscriptions", "entitlements", "studyRecords", "studyEvents"] as const) expect(after[field]).toEqual(before[field]);
    expect(after.accounts.find(item => item.provider === "wechat")).toMatchObject({ userId: target.id, providerSubject: "wx-app:openid", wechatUnionId: "union" });
    expect((await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "wx-app:openid" })).id).toBe(target.id);
    if (provider === "google") expect((await store.getOrCreateSocialUser({ provider: "google", providerSubject: "existing-google", email: target.email })).id).toBe(target.id);
    else expect((await store.authenticateUser("existing@example.test", "Original-password-123")).id).toBe(target.id);
    const replay = await confirmEmailBinding(bindingRequest(body, `learning_guide_session=${session!.value}`));
    expect(await replay.json()).toMatchObject({ alreadyBound: true, merged: true, sameUser: true });
    expect(replay.cookies.has("learning_guide_session")).toBe(false);
    const stolen = await confirmEmailBinding(bindingRequest(body));
    expect(await stolen.json()).toMatchObject({ alreadyBound: true, sameUser: false });
    expect(stolen.cookies.has("learning_guide_session")).toBe(false);
    const raw = await readFile(path.join(directory, "data/knowledge_system/learning_guide/product.json"), "utf8");
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(session!.value);
  }));
}

test("cross-device linking never logs in the mailbox browser; concurrent confirmations complete once", async () => withBindingStore(async store => {
  const target = await store.getOrCreateSocialUser({ provider: "google", providerSubject: "cross-google", email: "cross@example.test" });
  const source = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "cross-wechat" });
  const session = await store.createSession(source.id);
  const token = await store.issueEmailBinding(source.id, target.email!);
  const body = { token: token.token, confirmed: true, locale: "en-GB", returnTo: "https://evil.example" };
  const responses = await Promise.all([confirmEmailBinding(bindingRequest(body)), confirmEmailBinding(bindingRequest(body))]);
  const results = await Promise.all(responses.map(response => response.json()));
  expect(results.filter(result => result.alreadyBound === false)).toHaveLength(1);
  expect(results.every(result => result.sameUser === false && result.merged === true)).toBe(true);
  for (const response of responses) expect(response.cookies.has("learning_guide_session")).toBe(false);
  expect(results[0].continueUrl).toContain("returnTo=%2Fen-GB%2Faccount%2Fmy-learning");
  expect(await store.getUserBySessionToken(session.token, true)).toBeNull();
  expect((await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "cross-wechat" })).id).toBe(target.id);
}));

test("linking rejects source history, changed ownership, occupied identities and unavailable targets without partial writes", async () => withBindingStore(async (store, directory) => {
  const target = await store.getOrCreateSocialUser({ provider: "google", providerSubject: "guard-google", email: "guard@example.test" });
  const file = path.join(directory, "data/knowledge_system/learning_guide/product.json");
  const mutate = async (change: (data: Awaited<ReturnType<typeof store.ensureProductData>>) => void) => {
    const data = await store.ensureProductData(); change(data); await writeFile(file, JSON.stringify(data));
  };
  const source = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "guard-wechat" });
  const token = await store.issueEmailBinding(source.id, target.email!);
  const confirm = () => store.confirmEmailBinding(token.token, { confirmed: true });
  for (const status of ["pending", "disabled"] as const) {
    await mutate(data => { data.users.find(item => item.id === target.id)!.status = status; });
    await expect(confirm()).rejects.toThrow("account_unavailable");
    await expect(store.issueEmailBinding(source.id, target.email!)).rejects.toThrow("account_unavailable");
  }
  await mutate(data => { data.users.find(item => item.id === target.id)!.status = "active"; });
  await store.activateTrial(source.id, "epicureanism");
  await expect(confirm()).rejects.toThrow("source_has_history");
  const unchanged = await store.ensureProductData();
  expect(unchanged.accounts.find(item => item.userId === source.id)).toBeTruthy();
  expect(unchanged.emailBindingTokens.find(item => item.userId === source.id)?.usedAt).toBeNull();
  const other = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "other-wechat" });
  const otherToken = await store.issueEmailBinding(other.id, target.email!);
  await mutate(data => { data.users.find(item => item.id === target.id)!.email = "changed@example.test"; });
  await expect(store.confirmEmailBinding(otherToken.token, { confirmed: true })).rejects.toThrow("email_in_use");
  const malicious = new Request("https://binding.example.test/api/auth/email-binding/confirm", { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ token: otherToken.token, confirmed: true }) });
  expect((await confirmEmailBinding(malicious)).status).toBe(400);
}));

test("WeChat binding requires verified email, keeps identity, blocks conflicts and replays safely", async () => {
  const cwd = process.cwd(), env = { ...process.env }, transport = nodemailer.createTransport;
  const directory = await mkdtemp(path.join(tmpdir(), "learning-guide-binding-"));
  const mails: Array<{ text: string }> = [];
  nodemailer.createTransport = (() => ({ sendMail: async (mail: { text: string }) => { mails.push(mail); } })) as unknown as typeof nodemailer.createTransport;
  process.chdir(directory);
  Object.assign(process.env, { APP_ENV: "DEV", STORAGE_BACKEND: "local", SMTP_HOST: "smtp.example.test", SMTP_USER: "fake", SMTP_PASS: "fake", NEXT_PUBLIC_APP_URL: "https://binding.example.test" });
  try {
    const store = await import("../../services/productStore");
    const auth = await import("../../services/productAuth");
    const send = requestEmailBinding;
    const confirm = confirmEmailBinding;
    const user = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "binding:first" });
    const session = await store.createSession(user.id);
    const cookie = `learning_guide_session=${session.token}`;
    const req = (url: string, body: object, cookies = cookie) => new Request(`https://binding.example.test${url}`, { method: "POST", headers: { cookie: cookies, origin: "https://binding.example.test" }, body: JSON.stringify(body) });
    expect(await store.getUserBySessionToken(session.token)).toBeNull();
    expect((await auth.rejectIfUnauthenticated(req("/api/purchase/checkout", {})))?.status).toBe(401);
    expect((await send(req("/api/auth/email-binding/request", { email: "first@example.test" }, ""))).status).toBe(401);
    const result = await send(req("/api/auth/email-binding/request", { email: "first@example.test", locale: "zh-CN", returnTo: "/zh-CN/subscription?term=6#plans" }));
    expect(await result.json()).toEqual({ ok: true, accepted: true, retryAfter: 60 });
    expect(mails).toHaveLength(1);
    expect(await store.getPendingEmailBinding(user.id)).toMatchObject({ email: "first@example.test" });
    const url = new URL(mails[0].text.match(/https[^\s]+/)![0]);
    expect(url.searchParams.get("returnTo")).toBe("/zh-CN/subscription?term=6#plans");
    expect((await send(req("/api/auth/email-binding/request", { email: "first@example.test" }))).status).toBe(429);
    expect((await store.getUserBySessionToken(session.token, true))?.email).toBeNull();
    const body = { token: url.searchParams.get("token"), confirmed: true, returnTo: "/zh-CN/subscription?term=6#plans", locale: "zh-CN" };
    const external = await confirm(req("/api/auth/email-binding/confirm", body, ""));
    expect(await external.json()).toMatchObject({ ok: true, sameUser: false });
    const verified = await store.getUserBySessionToken(session.token);
    expect(verified).toMatchObject({ id: user.id, email: "first@example.test" });
    expect(await store.getPendingEmailBinding(user.id)).toBeNull();
    expect(await auth.rejectIfUnauthenticated(req("/api/purchase/checkout", {}))).toBeNull();
    const replay = await confirm(req("/api/auth/email-binding/confirm", body));
    expect(await replay.json()).toMatchObject({ ok: true, sameUser: true, alreadyBound: true, continueUrl: body.returnTo });
    const again = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "binding:first" });
    expect(again.id).toBe(user.id);
    expect(again.emailVerifiedAt).toBeTruthy();
    const other = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "binding:second" });
    const occupied = await store.issueEmailBinding(other.id, "first@example.test");
    await expect(store.confirmEmailBinding(occupied.token, { confirmed: true })).rejects.toThrow("account_conflict");
    const file = path.join(directory, "data/knowledge_system/learning_guide/product.json");
    async function ageTokens() {
      const data = JSON.parse(await readFile(file, "utf8"));
      data.emailBindingTokens.forEach((token: { createdAt: string }) => { token.createdAt = "2000-01-01T00:00:00Z"; });
      await writeFile(file, JSON.stringify(data));
    }
    await ageTokens();
    const old = await store.issueEmailBinding(other.id, "second@example.test");
    await ageTokens();
    const newer = await store.issueEmailBinding(other.id, "new@example.test");
    await expect(store.confirmEmailBinding(old.token, { confirmed: true })).rejects.toThrow("invalid_link");
    const data = JSON.parse(await readFile(file, "utf8"));
    data.emailBindingTokens.find((token: { userId: string }) => token.userId === other.id).expiresAt = "2000-01-01T00:00:00Z";
    await writeFile(file, JSON.stringify(data));
    await expect(store.confirmEmailBinding(newer.token, { confirmed: true })).rejects.toThrow("invalid_link");
    await ageTokens();
    const conflict = await store.issueEmailBinding(other.id, "race@example.test");
    await store.registerUser({ email: "race@example.test", password: "Test-password-123", nickname: "Test" });
    await expect(store.confirmEmailBinding(conflict.token, { confirmed: true })).rejects.toThrow("email_in_use");
    expect((await store.ensureProductData()).users.find(item => item.id === other.id)?.email).toBeNull();
  } finally {
    nodemailer.createTransport = transport; process.chdir(cwd); process.env = env;
    if (path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
  }
});
