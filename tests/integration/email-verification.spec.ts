import { expect, test } from "playwright/test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { OAuth2Client } from "google-auth-library";

test("email registration requires a one-time verification token before sign-in", async () => {
  const originalCwd = process.cwd();
  const isolatedCwd = await mkdtemp(path.join(tmpdir(), "learning-guide-auth-"));
  process.chdir(isolatedCwd);
  try {
    const store = await import("../../services/productStore");
    const user = await store.registerUser({ email: "pending@example.test", password: "strong-password", nickname: "Learner", locale: "en-GB" });
    expect(user.status).toBe("pending");
    expect(user.emailVerifiedAt).toBeNull();
    await expect(store.authenticateUser(user.email, "strong-password")).rejects.toThrow("Verify your email address");

    const token = await store.issueEmailVerificationToken(user.id);
    const activated = await store.verifyEmailToken(token);
    expect(activated.status).toBe("active");
    expect(activated.emailVerifiedAt).toBeTruthy();
    await expect(store.verifyEmailToken(token)).rejects.toThrow("invalid or has expired");

    const signedIn = await store.authenticateUser(user.email, "strong-password");
    const session = await store.createSession(signedIn.id);
    expect((await store.getUserBySessionToken(session.token))?.id).toBe(user.id);

    await expect(store.getOrCreateSocialUser({ provider: "google", providerSubject: "google-conflict", email: user.email, nickname: "Google User", locale: "en-GB" })).rejects.toMatchObject({ code: "account_conflict" });
    const googleUser = await store.getOrCreateSocialUser({ provider: "google", providerSubject: "google-subject", email: "google@example.test", nickname: "Google User", locale: "en-GB" });
    expect(googleUser.status).toBe("active");
    expect(googleUser.emailVerifiedAt).toBeTruthy();
    expect(googleUser.passwordHash).toBeNull();
    expect((await store.getOrCreateSocialUser({ provider: "google", providerSubject: "google-subject", email: "google-renamed@example.test", locale: "en-GB" })).id).toBe(googleUser.id);
    await expect(store.authenticateUser("google-renamed@example.test", "not-a-password")).rejects.toThrow("Email or password is incorrect");
  } finally {
    process.chdir(originalCwd);
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test("Google OAuth transaction is signed, state-bound and carries PKCE data", async () => {
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  const oauth = await import("../../services/oauthService");
  const transaction = oauth.makeOAuthState("zh-CN", "/zh-CN/account/my-learning");
  expect(transaction.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  const accepted = oauth.readOAuthState(transaction.cookieValue, transaction.state);
  expect(accepted).toMatchObject({ locale: "zh-CN", returnTo: "/zh-CN/account/my-learning", nonce: transaction.nonce });
  expect(accepted?.codeVerifier).toBeTruthy();
  expect(oauth.readOAuthState(transaction.cookieValue, "different-state")).toBeNull();
  expect(oauth.readOAuthState(transaction.cookieValue, transaction.state, "wechat")).toBeNull();
  expect(oauth.readOAuthState(`${transaction.cookieValue}tampered`, transaction.state)).toBeNull();
});

test("Google profile accepts only a verified email and matching OIDC nonce", async () => {
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  const oauth = await import("../../services/oauthService");
  const prototype = OAuth2Client.prototype as unknown as { getToken: (...args: unknown[]) => Promise<unknown>; verifyIdToken: (...args: unknown[]) => Promise<unknown> };
  const originalGetToken = prototype.getToken;
  const originalVerifyIdToken = prototype.verifyIdToken;
  let payload = { sub: "google-subject", email: "Google@Example.test", email_verified: true, nonce: "expected-nonce", name: "Google User" };
  prototype.getToken = async () => ({ tokens: { id_token: "signed-id-token" } });
  prototype.verifyIdToken = async () => ({ getPayload: () => payload });
  try {
    await expect(oauth.fetchGoogleProfile("authorization-code", "http://localhost:3000/api/auth/google/callback", { nonce: "expected-nonce", codeVerifier: "pkce-verifier" })).resolves.toMatchObject({ subject: "google-subject", email: "google@example.test" });
    payload = { ...payload, email_verified: false };
    await expect(oauth.fetchGoogleProfile("authorization-code", "http://localhost:3000/api/auth/google/callback", { nonce: "expected-nonce", codeVerifier: "pkce-verifier" })).rejects.toMatchObject({ code: "email" });
    payload = { ...payload, email_verified: true, nonce: "wrong-nonce" };
    await expect(oauth.fetchGoogleProfile("authorization-code", "http://localhost:3000/api/auth/google/callback", { nonce: "expected-nonce", codeVerifier: "pkce-verifier" })).rejects.toMatchObject({ code: "token" });
  } finally {
    prototype.getToken = originalGetToken;
    prototype.verifyIdToken = originalVerifyIdToken;
  }
});
