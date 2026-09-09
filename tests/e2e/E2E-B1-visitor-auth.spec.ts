import { expect, test } from "playwright/test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const PASSWORD = "Passw0rd!123";

const publicPaths = [
  "/en-GB/portal",
  "/zh-CN/portal",
  "/en-GB/portal/courses",
  "/zh-CN/portal/courses",
  "/en-GB/portal/courses/epicureanism",
  "/en-GB/portal/courses/epicureanism/public-lesson",
];

test.describe("E2E-B1-001", () => {
  test("public pages return 200; unauthenticated study/events does not grant access", async ({ request }) => {
    for (const route of publicPaths) {
      expect((await request.get(route)).status(), route).toBe(200);
    }
    const write = await request.post("/api/study/events", {
      data: {
        courseId: "epicureanism",
        lessonId: "pleasure-and-the-good-life",
        event: "complete",
        seconds: 60,
        clientEventId: `visitor-${Date.now()}`,
      },
    });
    expect(write.status(), "unauthenticated study/events must not open access").not.toBe(200);
  });
});

test.describe("E2E-B1-002", () => {
  test("verification success does not create a session", async () => {
    const originalCwd = process.cwd();
    const originalFlag = process.env.EMAIL_VERIFICATION_REQUIRED;
    const isolatedCwd = await mkdtemp(path.join(tmpdir(), "learning-guide-e2e-002-"));
    process.env.EMAIL_VERIFICATION_REQUIRED = "1";
    process.chdir(isolatedCwd);
    try {
      const store = await import("../../services/productStore");
      const user = await store.registerUser({
        email: `e2e-002-${Date.now()}@example.test`,
        password: PASSWORD,
        nickname: "E2E Learner",
        locale: "en-GB",
      });
      expect(user.status).toBe("pending");
      const token = await store.issueEmailVerificationToken(user.id);
      const activated = await store.verifyEmailToken(token);
      expect(activated.status).toBe("active");
      expect(activated.emailVerifiedAt).toBeTruthy();
      const data = await store.ensureProductData();
      expect(data.sessions.filter((session) => session.userId === user.id)).toEqual([]);
      expect(await store.getUserBySessionToken(undefined)).toBeNull();
    } finally {
      process.chdir(originalCwd);
      if (originalFlag === undefined) delete process.env.EMAIL_VERIFICATION_REQUIRED;
      else process.env.EMAIL_VERIFICATION_REQUIRED = originalFlag;
      await rm(isolatedCwd, { recursive: true, force: true });
    }
  });
});

test.describe("E2E-B1-003", () => {
  test("verify-email succeeds without a session; token replay returns 400", async () => {
    const originalCwd = process.cwd();
    const originalFlag = process.env.EMAIL_VERIFICATION_REQUIRED;
    const isolatedCwd = await mkdtemp(path.join(tmpdir(), "learning-guide-e2e-003-"));
    process.env.EMAIL_VERIFICATION_REQUIRED = "1";
    process.chdir(isolatedCwd);
    try {
      const store = await import("../../services/productStore");
      const { POST: verifyEmail } = await import("../../app/api/auth/verify-email/route");
      const user = await store.registerUser({
        email: `e2e-003-${Date.now()}@example.test`,
        password: PASSWORD,
        nickname: "E2E Learner",
        locale: "en-GB",
      });
      const token = await store.issueEmailVerificationToken(user.id);
      const first = await verifyEmail(new Request("http://127.0.0.1/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }));
      expect(first.status).toBe(200);
      expect(first.headers.get("set-cookie") || "").not.toContain("learning_guide_session");
      const data = await store.ensureProductData();
      expect(data.sessions.filter((session) => session.userId === user.id)).toEqual([]);

      const replay = await verifyEmail(new Request("http://127.0.0.1/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }));
      expect(replay.status).toBe(400);
      expect((await replay.json()).code).toBe("VERIFICATION_TOKEN_INVALID");
      await expect(store.verifyEmailToken(token)).rejects.toThrow(/invalid or has expired/i);
    } finally {
      process.chdir(originalCwd);
      if (originalFlag === undefined) delete process.env.EMAIL_VERIFICATION_REQUIRED;
      else process.env.EMAIL_VERIFICATION_REQUIRED = originalFlag;
      await rm(isolatedCwd, { recursive: true, force: true });
    }
  });
});
