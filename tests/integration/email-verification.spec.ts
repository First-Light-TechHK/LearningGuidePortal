import { expect, test } from "playwright/test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

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
  } finally {
    process.chdir(originalCwd);
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});
