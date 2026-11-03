// Student Management PRD v1.0 (2026-11-01): feature access matrix (6.3), FA-01..06, account actions (ST-03/05/06/08)
// and the AI Support Assistant gate. Runs against the local product store in an isolated working directory.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
const originalSmtp = process.env.SMTP_HOST;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let sm: typeof import("../../modules/student-management/service");
let contract: typeof import("../../contracts/student-management");

const actor = { id: "emp_1", name: "Ops Lead", role: "ADMIN" };
const request = new Request("http://lg.test/api/integration/students");
const DAY = 86_400_000;

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-student-mgmt-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  delete process.env.SMTP_HOST;
  store = await import("../../services/productStore");
  sm = await import("../../modules/student-management/service");
  contract = await import("../../contracts/student-management");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (originalSmtp !== undefined) process.env.SMTP_HOST = originalSmtp;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

let seq = 0;
async function learner(opts: { aiTutor?: boolean; nickname?: string } = {}) {
  seq += 1;
  const email = `sm-${seq}@example.test`;
  const user = await store.registerUser({ email, password: "password1", nickname: opts.nickname ?? `Learner ${seq}` });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  if (opts.aiTutor) {
    await store.editProductData((data) => {
      if (!data.plans.some((plan) => plan.id === "sm-pc-all")) {
        data.plans.push({ id: "sm-pc-all", courseId: "*", name: "All courses", termMonths: 6, device: "pc", amountMinor: 100, currency: "usd", scope: "everything" });
      }
      data.subscriptions.push({
        id: `sm-sub-${seq}`, userId: user.id, planId: "sm-pc-all", courseId: "*", state: "active", source: "purchase",
        validFrom: new Date(Date.now() - DAY).toISOString(), validTo: new Date(Date.now() + 30 * DAY).toISOString(), cancelAtPeriodEnd: false, scope: "everything", device: "pc",
      });
    });
  }
  return { ...user, email };
}

function feature(details: Awaited<ReturnType<typeof sm.getStudent>>, key: "improve_tutor" | "ai_support_assistant") {
  return details.features.find((row) => row.feature === key)!;
}

async function setOverride(userId: string, key: "improve_tutor" | "ai_support_assistant", value: "default" | "allow" | "deny") {
  const current = await sm.getStudent(userId);
  return sm.saveOverrides(userId, { actor, reason: "pilot", expectedVersion: current.overridesVersion, overrides: { [key]: value } });
}

async function setGlobal(key: "improve_tutor" | "ai_support_assistant", enabled: boolean) {
  const current = await sm.getFeatureSettings();
  return sm.saveFeatureSettings({ actor, reason: "release", expectedVersion: current.version, features: { [key]: { enabled } } });
}

test("defaults: Improve Tutor off (needs AI Tutor), AI Support Assistant on (owner decision 2026-11-02)", async () => {
  const plain = await learner();
  const tutor = await learner({ aiTutor: true });
  assert.deepEqual(feature(await sm.getStudent(plain.id), "improve_tutor"), { feature: "improve_tutor", override: "default", enabled: false, reason: "missing_prerequisite" });
  assert.equal(feature(await sm.getStudent(tutor.id), "improve_tutor").reason, "global_off");
  assert.deepEqual(feature(await sm.getStudent(plain.id), "ai_support_assistant"), { feature: "ai_support_assistant", override: "default", enabled: true, reason: "global_on" });
});

test("PRD 6.3 matrix: Allow beats global Off, Deny beats global On, prerequisite beats Allow (FA-01, FA-02, FA-03)", async () => {
  const tutor = await learner({ aiTutor: true });
  const plain = await learner();
  assert.equal(feature(await setOverride(tutor.id, "improve_tutor", "allow"), "improve_tutor").reason, "override_allow");
  assert.equal(feature(await sm.getStudent(tutor.id), "improve_tutor").enabled, true);
  const blocked = feature(await setOverride(plain.id, "improve_tutor", "allow"), "improve_tutor");
  assert.equal(blocked.enabled, false);
  assert.equal(blocked.reason, "missing_prerequisite");
  const denied = feature(await setOverride(plain.id, "ai_support_assistant", "deny"), "ai_support_assistant");
  assert.deepEqual([denied.enabled, denied.reason], [false, "override_deny"]);
  assert.equal(await sm.isFeatureEnabled(plain.id, "ai_support_assistant"), false);
  await setOverride(plain.id, "ai_support_assistant", "default");
  assert.equal(await sm.isFeatureEnabled(plain.id, "ai_support_assistant"), true);
});

test("a global change never rewrites individual overrides (FA-06) and is version-checked", async () => {
  const tutor = await learner({ aiTutor: true });
  await setOverride(tutor.id, "improve_tutor", "deny");
  const before = await sm.getFeatureSettings();
  const afterOn = await setGlobal("improve_tutor", true);
  assert.notEqual(afterOn.version, before.version);
  assert.equal(afterOn.features.find((row) => row.feature === "improve_tutor")!.globalEnabled, true);
  assert.equal(feature(await sm.getStudent(tutor.id), "improve_tutor").reason, "override_deny");
  await assert.rejects(
    () => sm.saveFeatureSettings({ actor, reason: "", expectedVersion: before.version, features: { improve_tutor: { enabled: false } } }),
    (error: unknown) => error instanceof contract.StudentProblem && error.code === "version_conflict",
  );
  await setGlobal("improve_tutor", false);
  assert.equal(feature(await sm.getStudent(tutor.id), "improve_tutor").override, "deny");
});

test("emergency off beats Allow, keeps the stored settings and resumes cleanly", async () => {
  const tutor = await learner({ aiTutor: true });
  await setOverride(tutor.id, "improve_tutor", "allow");
  const off = await sm.setEmergencyOff({ actor, feature: "improve_tutor", off: true, reason: "incident" });
  assert.equal(off.features.find((row) => row.feature === "improve_tutor")!.emergencyOff?.reason, "incident");
  const row = feature(await sm.getStudent(tutor.id), "improve_tutor");
  assert.deepEqual([row.enabled, row.reason, row.override], [false, "emergency_off", "allow"]);
  await sm.setEmergencyOff({ actor, feature: "improve_tutor", off: false, reason: "fixed" });
  assert.equal(feature(await sm.getStudent(tutor.id), "improve_tutor").reason, "override_allow");
});

test("overrides save with optimistic concurrency and refuse inactive accounts", async () => {
  const user = await learner();
  const first = await sm.getStudent(user.id);
  await sm.saveOverrides(user.id, { actor, reason: "a", expectedVersion: first.overridesVersion, overrides: { ai_support_assistant: "deny" } });
  await assert.rejects(
    () => sm.saveOverrides(user.id, { actor, reason: "b", expectedVersion: first.overridesVersion, overrides: { ai_support_assistant: "allow" } }),
    (error: unknown) => error instanceof contract.StudentProblem && error.code === "version_conflict",
  );
  await sm.runStudentAction(user.id, { action: "deactivate", actor, reason: "abuse" }, request);
  const inactive = await sm.getStudent(user.id);
  await assert.rejects(
    () => sm.saveOverrides(user.id, { actor, reason: "c", expectedVersion: inactive.overridesVersion, overrides: { ai_support_assistant: "allow" } }),
    (error: unknown) => error instanceof contract.StudentProblem && error.code === "account_inactive",
  );
});

test("deactivate signs out, blocks sign-in and every feature; activate restores and keeps overrides (ST-03, FA-05)", async () => {
  const user = await learner({ aiTutor: true });
  await setOverride(user.id, "improve_tutor", "allow");
  const session = await store.createSession(user.id);
  const result = await sm.runStudentAction(user.id, { action: "deactivate", actor, reason: "chargeback" }, request);
  assert.equal(result.student.accountStatus, "inactive");
  assert.equal(result.student.deactivation?.reason, "chargeback");
  assert.equal(await store.getUserBySessionToken(session.token), null);
  await assert.rejects(() => store.authenticateUser(user.email, "password1"));
  assert.ok(result.student.features.every((row) => !row.enabled && row.reason === "account_inactive"));
  assert.equal(result.student.passwordLink.available, false);
  // Idempotent: repeating records nothing new.
  await sm.runStudentAction(user.id, { action: "deactivate", actor, reason: "again" }, request);
  const events = (await store.readProductData()).studentAdminEvents!.filter((event) => event.userId === user.id && event.action === "account.deactivated");
  assert.equal(events.length, 1);
  const back = await sm.runStudentAction(user.id, { action: "activate", actor, reason: "resolved" }, request);
  assert.equal(back.student.accountStatus, "active");
  assert.equal(feature(back.student, "improve_tutor").reason, "override_allow");
  assert.equal((await store.authenticateUser(user.email, "password1")).id, user.id);
});

test("change email: never takes another account's address (ST-05); exempt marks verified, standard goes pending and signs out", async () => {
  const user = await learner();
  const other = await learner();
  await assert.rejects(
    () => sm.runStudentAction(user.id, { action: "change_email", actor, email: other.email, reason: "ticket 1", exemption: null }, request),
    (error: unknown) => error instanceof contract.StudentProblem && error.code === "email_taken",
  );
  const exempt = await sm.runStudentAction(user.id, { action: "change_email", actor, email: `new-${user.id}@example.test`, reason: "ticket 2", exemption: { reference: "ID check 42" } }, request);
  assert.equal(exempt.student.emailVerification, "admin_exempt");
  assert.equal(exempt.student.emailExemption?.reference, "ID check 42");
  const session = await store.createSession(user.id);
  const standard = await sm.runStudentAction(user.id, { action: "change_email", actor, email: `pending-${user.id}@example.test`, reason: "ticket 3", exemption: null }, request);
  assert.equal(standard.student.emailVerification, "pending");
  assert.equal(standard.student.passwordLink.available, false);
  // No SMTP in tests: the change is saved and reported as not sent, never as an error.
  assert.deepEqual(standard.email, { sent: false });
  assert.equal(await store.getUserBySessionToken(session.token), null);
});

test("email actions report email_unavailable when the environment cannot send mail", async () => {
  const user = await learner();
  for (const action of ["send_password_link", "resend_verification"] as const) {
    await assert.rejects(
      () => sm.runStudentAction(user.id, { action, actor }, request),
      (error: unknown) => error instanceof contract.StudentProblem && error.code === "email_unavailable",
    );
  }
});

test("list: learners only, newest first, filters and counts (ST-01)", async () => {
  await store.registerUser({ email: "sm-staff@example.test", password: "password1", role: "operator" });
  const target = await learner({ nickname: "Zed Findable" });
  await setOverride(target.id, "ai_support_assistant", "deny");
  const all = await sm.listStudents(contract.parseStudentListQuery(new URLSearchParams("pageSize=100")));
  assert.ok(all.items.every((item) => !item.email?.includes("staff")));
  assert.equal(all.items[0]!.id, target.id);
  assert.equal(all.counts.total, all.counts.active + all.counts.inactive);
  const byName = await sm.listStudents(contract.parseStudentListQuery(new URLSearchParams("q=zed find")));
  assert.deepEqual(byName.items.map((item) => item.id), [target.id]);
  const byId = await sm.listStudents(contract.parseStudentListQuery(new URLSearchParams(`q=${target.id}`)));
  assert.deepEqual(byId.items.map((item) => item.id), [target.id]);
  const special = await sm.listStudents(contract.parseStudentListQuery(new URLSearchParams("special=ai_support_assistant&pageSize=100")));
  assert.ok(special.items.some((item) => item.id === target.id));
  assert.ok(special.items.every((item) => item.specialAccess.some((row) => row.feature === "ai_support_assistant")));
  const inactive = await sm.listStudents(contract.parseStudentListQuery(new URLSearchParams("status=inactive&pageSize=100")));
  assert.ok(inactive.items.every((item) => item.accountStatus === "inactive"));
  assert.equal(inactive.total, all.counts.inactive);
});

test("contract parsers reject bad input", () => {
  assert.throws(() => contract.parseStudentListQuery(new URLSearchParams("pageSize=101")), contract.StudentProblem);
  assert.throws(() => contract.parseStudentActionInput({ action: "change_email", actor, email: "not-an-email", reason: "x", exemption: null }), contract.StudentProblem);
  assert.throws(() => contract.parseOverridesInput({ actor, reason: "x", expectedVersion: "v", overrides: { improve_tutor: "maybe" } }), contract.StudentProblem);
  assert.throws(() => contract.parseEmergencyInput({ actor, feature: "improve_tutor", off: true, reason: "" }), contract.StudentProblem);
  assert.equal(contract.parseStudentActionInput({ action: "change_email", actor, email: "Mixed@Example.TEST", reason: "x", exemption: null }).action, "change_email");
});

test("M3 (review 2026-11-03): deactivate evicts the learner from every live Study Group room; a failing eviction never fails the deactivation", async () => {
  const evicted: string[] = [];
  const original = sm.studentManagementHooks.evictFromLiveSessions;
  sm.studentManagementHooks.evictFromLiveSessions = async (userId) => { evicted.push(userId); };
  try {
    const user = await learner();
    const result = await sm.runStudentAction(user.id, { action: "deactivate", actor, reason: "fraud" }, request);
    assert.equal(result.student.accountStatus, "inactive");
    assert.deepEqual(evicted, [user.id]);
    await sm.runStudentAction(user.id, { action: "activate", actor, reason: "ok" }, request);
    assert.deepEqual(evicted, [user.id], "activate evicts nobody");
    sm.studentManagementHooks.evictFromLiveSessions = async () => { throw new Error("provider down"); };
    const again = await sm.runStudentAction(user.id, { action: "deactivate", actor, reason: "fraud" }, request);
    assert.equal(again.student.accountStatus, "inactive", "the account is inactive even when the room provider fails");
  } finally {
    sm.studentManagementHooks.evictFromLiveSessions = original;
  }
});

test("L3 (review 2026-11-03): isFeatureEnabled is cached per learner for a few seconds and every write in this module clears it", async () => {
  const user = await learner();
  assert.equal(await sm.isFeatureEnabled(user.id, "ai_support_assistant"), true);
  await setOverride(user.id, "ai_support_assistant", "deny");
  assert.equal(await sm.isFeatureEnabled(user.id, "ai_support_assistant"), false, "an override is seen at once");
  await setOverride(user.id, "ai_support_assistant", "default");
  assert.equal(await sm.isFeatureEnabled(user.id, "ai_support_assistant"), true);
  // A write that bypasses this module (another instance) is seen once the entry expires.
  sm.clearFeatureCache(user.id);
  const t0 = Date.now();
  assert.equal(await sm.isFeatureEnabled(user.id, "ai_support_assistant", t0), true);
  await store.editProductData((data) => {
    (data.featureAccess ||= { globals: [], overrides: [], version: 0 }).overrides.push({ userId: user.id, feature: "ai_support_assistant", value: "deny", reason: "elsewhere", updated: { at: new Date().toISOString(), byId: "emp", byName: "Ops" } });
  });
  assert.equal(await sm.isFeatureEnabled(user.id, "ai_support_assistant", t0 + sm.FEATURE_CACHE_MS - 1), true, "still cached");
  assert.equal(await sm.isFeatureEnabled(user.id, "ai_support_assistant", t0 + sm.FEATURE_CACHE_MS), false, "expired: read again");
  sm.clearFeatureCache(user.id);
  await setGlobal("ai_support_assistant", false);
  const fresh = await learner();
  assert.equal(await sm.isFeatureEnabled(fresh.id, "ai_support_assistant"), false);
  await setGlobal("ai_support_assistant", true);
  assert.equal(await sm.isFeatureEnabled(fresh.id, "ai_support_assistant"), true, "a global change clears every entry");
  await sm.runStudentAction(fresh.id, { action: "deactivate", actor, reason: "x" }, request);
  assert.equal(await sm.isFeatureEnabled(fresh.id, "ai_support_assistant"), false, "deactivation clears the entry");
});
