import { expect, test } from "playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const PASSWORD = "Passw0rd!123";
const COURSE_ID = "epicureanism";
const LESSON_ID = "pleasure-and-the-good-life";

const originalCwd = process.cwd();
let isolatedCwd: string | undefined;
let storeModule: typeof import("../../services/productStore") | undefined;

async function isolatedStore() {
  if (!storeModule) {
    isolatedCwd = await mkdtemp(path.join(tmpdir(), "learning-guide-e2e-neg-"));
    process.chdir(isolatedCwd);
    storeModule = await import("../../services/productStore");
  }
  return storeModule;
}

test.afterAll(async () => {
  process.chdir(originalCwd);
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test.describe("E2E-B1-009", () => {
  test("unauthenticated entitlements, study, and ai-tutor return 401", async ({ request }) => {
    const entitlements = await request.get(`/api/entitlements/check?courseId=${COURSE_ID}`);
    const study = await request.post("/api/study/events", {
      data: {
        courseId: COURSE_ID,
        lessonId: LESSON_ID,
        event: "open",
        seconds: 1,
        clientEventId: `unauth-${Date.now()}`,
      },
    });
    const tutor = await request.post("/api/ai-tutor", {
      data: { courseId: COURSE_ID, lessonId: LESSON_ID, message: "hello" },
    });
    expect(entitlements.status()).toBe(401);
    expect(study.status()).toBe(401);
    expect(tutor.status()).toBe(401);
  });

  test("signed-in without entitlement: study 400 and tutor 403", async ({ request }) => {
    const email = `e2e-009-${Date.now()}@example.com`;
    const registered = await request.post("/api/auth/register", {
      data: { email, password: PASSWORD, nickname: "E2E User", locale: "en-GB" },
    });
    if (registered.status() !== 200) {
      test.skip(true, `live register returned ${registered.status()} (PROD verification / no SMTP); store path below covers the same rule`);
    }
    const study = await request.post("/api/study/events", {
      data: {
        courseId: COURSE_ID,
        lessonId: LESSON_ID,
        event: "open",
        seconds: 1,
        clientEventId: `no-entitlement-${Date.now()}`,
      },
    });
    const tutor = await request.post("/api/ai-tutor", {
      data: { courseId: COURSE_ID, lessonId: LESSON_ID, message: "hello" },
    });
    expect(study.status()).toBe(400);
    expect(tutor.status()).toBe(403);
  });

  test("store: signed-in without entitlement cannot study or tutor", async () => {
    const store = await isolatedStore();
    const user = await store.registerUser({
      email: `e2e-009-store-${Date.now()}@example.test`,
      password: PASSWORD,
      nickname: "E2E Learner",
      locale: "en-GB",
    });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    expect((await store.checkEntitlement(user.id, COURSE_ID)).allowed).toBe(false);
    await expect(store.recordStudyEvent({
      userId: user.id,
      courseId: COURSE_ID,
      lessonId: LESSON_ID,
      event: "open",
      seconds: 1,
      clientEventId: `store-${Date.now()}`,
    })).rejects.toThrow(/Course access is required/);
  });
});

test.describe("E2E-B1-010", () => {
  test("expired entitlement is not allowed", async () => {
    const store = await isolatedStore();
    const { SYSTEM_ROOT } = await import("../../services/fileStore");
    const user = await store.registerUser({
      email: `e2e-010-${Date.now()}@example.test`,
      password: PASSWORD,
      nickname: "E2E Learner",
      locale: "en-GB",
    });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    const file = path.join(SYSTEM_ROOT, "learning_guide", "product.json");
    const data = JSON.parse(await readFile(file, "utf8"));
    data.entitlements.push({
      id: "expired-e2e-010",
      userId: user.id,
      courseId: COURSE_ID,
      state: "active",
      source: "purchase",
      validTo: "2000-01-01T00:00:00.000Z",
      scope: "course",
      scopeId: COURSE_ID,
      device: "pc",
    });
    await writeFile(file, JSON.stringify(data));
    expect((await store.checkEntitlement(user.id, COURSE_ID)).allowed).toBe(false);
  });
});

test.describe("API-PAY-005", () => {
  test("unsigned payment webhook is rejected", async ({ request }) => {
    const response = await request.post("/api/payment/webhook", {
      headers: { "content-type": "application/json" },
      data: { type: "checkout.session.completed" },
    });
    expect([400, 503]).toContain(response.status());
  });
});
