import { expect, test } from "playwright/test";
import "./helpers/preload-native-modules";
import { mkdtemp, readFile, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import nodemailer from "nodemailer";
import { POST as requestEmailBinding } from "../../app/api/auth/email-binding/request/route";
import { POST as confirmEmailBinding } from "../../app/api/auth/email-binding/confirm/route";

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
    const result = await send(req("/api/auth/email-binding/request", { email: "first@example.test", locale: "zh-CN", returnTo: "/zh-CN/pricing?term=6#plans" }));
    expect(await result.json()).toEqual({ ok: true, accepted: true, retryAfter: 60 });
    expect(mails).toHaveLength(1);
    expect(await store.getPendingEmailBinding(user.id)).toMatchObject({ email: "first@example.test" });
    const url = new URL(mails[0].text.match(/https[^\s]+/)![0]);
    expect(url.searchParams.get("returnTo")).toBe("/zh-CN/pricing?term=6#plans");
    expect((await send(req("/api/auth/email-binding/request", { email: "first@example.test" }))).status).toBe(429);
    expect((await store.getUserBySessionToken(session.token, true))?.email).toBeNull();
    const body = { token: url.searchParams.get("token"), returnTo: "/zh-CN/pricing?term=6#plans", locale: "zh-CN" };
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
    await expect(store.issueEmailBinding(other.id, "first@example.test")).rejects.toThrow("email_in_use");
    const old = await store.issueEmailBinding(other.id, "second@example.test");
    const file = path.join(directory, "data/knowledge_system/learning_guide/product.json");
    async function ageTokens() {
      const data = JSON.parse(await readFile(file, "utf8"));
      data.emailBindingTokens.forEach((token: { createdAt: string }) => { token.createdAt = "2000-01-01T00:00:00Z"; });
      await writeFile(file, JSON.stringify(data));
    }
    await ageTokens();
    const newer = await store.issueEmailBinding(other.id, "new@example.test");
    await expect(store.confirmEmailBinding(old.token)).rejects.toThrow("invalid_link");
    const data = JSON.parse(await readFile(file, "utf8"));
    data.emailBindingTokens.find((token: { userId: string }) => token.userId === other.id).expiresAt = "2000-01-01T00:00:00Z";
    await writeFile(file, JSON.stringify(data));
    await expect(store.confirmEmailBinding(newer.token)).rejects.toThrow("invalid_link");
    await ageTokens();
    const conflict = await store.issueEmailBinding(other.id, "race@example.test");
    await store.registerUser({ email: "race@example.test", password: "Test-password-123", nickname: "Test" });
    await expect(store.confirmEmailBinding(conflict.token)).rejects.toThrow("email_in_use");
    expect((await store.ensureProductData()).users.find(item => item.id === other.id)?.email).toBeNull();
  } finally {
    nodemailer.createTransport = transport; process.chdir(cwd); process.env = env;
    if (path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
  }
});
