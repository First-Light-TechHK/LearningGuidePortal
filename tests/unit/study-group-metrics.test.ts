import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createStudyGroupService, type StudyGroupDeps } from "../../modules/group-study/service";
import {
  createStudyGroupRepository,
  StudyGroupStoreUnsupportedError,
  type StudyGroupOperationalMetrics,
  type StudyGroupRepository
} from "../../modules/group-study/repository";
import { GET as healthConfig } from "../../app/api/health/config/route";

// Phase C slice 3: redacted operational metrics (service + runtime contract)
// and the redacted `studyGroup` entry on /api/health/config. Counts only —
// nothing here may carry identities, ids, or payload contents.

const NOW = "2026-10-11T02:00:00.000Z";
const METRICS: StudyGroupOperationalMetrics = {
  tutorQueued: 3,
  tutorInFlight: 1,
  tutorDeadLetter: 2,
  tutorOldestQueuedAgeSeconds: 417,
  webhookAbandoned: 5,
  webhookFailed: 7
};

const createdDirectories: string[] = [];
async function fileStore(): Promise<StudyGroupRepository> {
  const directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-metrics-"));
  createdDirectories.push(directory);
  return createStudyGroupRepository(directory);
}

function serviceWithRepository(repository: StudyGroupRepository) {
  const deps: StudyGroupDeps = {
    repository,
    now: () => new Date(NOW),
    hasCourseAccess: async () => true,
    courseSummary: async (courseId) => ({ id: courseId, title: "German History", slug: "german-history" }),
    accessibleCourses: async () => [],
    userProfile: async (userId) => ({ id: userId, displayName: userId, email: null, locale: "en-GB" }),
    notify: async () => undefined,
    listReminders: async () => [],
    sendMail: async () => undefined,
    liveKit: { apiKey: "lk-key", apiSecret: "lk-secret-at-least-32-characters", url: "wss://livekit.example.test" },
    tokenLogKey: () => Buffer.alloc(32, 7)
  };
  return createStudyGroupService(deps);
}

const environmentKeys = ["APP_ENV", "STUDY_GROUP_STORE", "DATABASE_URL", "LIVEKIT_PROJECTS_JSON", "STUDY_GROUP_TOKEN_LOG_KEY"] as const;
const savedEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

after(async () => {
  for (const key of environmentKeys) {
    const value = savedEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const directory of createdDirectories) await rm(directory, { recursive: true, force: true });
});

test("operationalMetrics returns the repository's metrics unchanged", async () => {
  const repository: StudyGroupRepository = {
    ...(await fileStore()),
    studyGroupOperationalMetrics: async () => METRICS
  };
  const service = serviceWithRepository(repository);
  const result = await service.operationalMetrics();
  assert.deepEqual(result, METRICS);
  assert.deepEqual(Object.keys(result).sort(), [
    "tutorDeadLetter",
    "tutorInFlight",
    "tutorOldestQueuedAgeSeconds",
    "tutorQueued",
    "webhookAbandoned",
    "webhookFailed"
  ].sort());
});

test("the file store refuses operational metrics with the typed unsupported error", async () => {
  const repository = await fileStore();
  const service = serviceWithRepository(repository);
  await assert.rejects(
    () => service.operationalMetrics(),
    (error: unknown) => error instanceof StudyGroupStoreUnsupportedError && (error as StudyGroupStoreUnsupportedError).code === "store_unsupported"
  );
  assert.throws(() => repository.studyGroupOperationalMetrics(), StudyGroupStoreUnsupportedError);
});

test("the emitted metrics sample is counts only with exactly the six numeric fields and the store marker", async () => {
  const repository: StudyGroupRepository = {
    ...(await fileStore()),
    studyGroupOperationalMetrics: async () => METRICS
  };
  const service = serviceWithRepository(repository);
  // The exact object the runtime metrics timer logs.
  const emitted = JSON.parse(JSON.stringify({ type: "study_group.metrics", store: "postgres", ...(await service.operationalMetrics()) })) as Record<string, unknown>;
  assert.equal(emitted.type, "study_group.metrics");
  assert.equal(emitted.store, "postgres");
  assert.deepEqual(Object.keys(emitted).sort(), [
    "store",
    "tutorDeadLetter",
    "tutorInFlight",
    "tutorOldestQueuedAgeSeconds",
    "tutorQueued",
    "type",
    "webhookAbandoned",
    "webhookFailed"
  ].sort());
  for (const field of ["tutorQueued", "tutorInFlight", "tutorDeadLetter", "tutorOldestQueuedAgeSeconds", "webhookAbandoned", "webhookFailed"]) {
    assert.equal(typeof emitted[field], "number", `${field} must be a number`);
    assert.equal(Number.isFinite(emitted[field] as number), true, `${field} must be finite`);
  }
});

test("health/config detects the file store and reports the studyGroup entry without echoing values", async () => {
  delete process.env.STUDY_GROUP_STORE;
  delete process.env.DATABASE_URL;
  process.env.APP_ENV = "DEV";
  const projectsJson = JSON.stringify([{ id: "lg-dev", url: "wss://lg-dev.livekit.cloud", state: "active", credentialSecretId: "lg/livekit/dev" }]);
  const tokenKey = Buffer.alloc(32, 11).toString("base64");
  process.env.LIVEKIT_PROJECTS_JSON = projectsJson;
  process.env.STUDY_GROUP_TOKEN_LOG_KEY = tokenKey;
  const body = await (await healthConfig()).json() as Record<string, unknown>;
  assert.deepEqual(body.studyGroup, { store: "file", configured: true });
  // Threading the entry through must not change the existing keys.
  for (const key of ["environment", "ready", "storage", "payment", "authentication"]) {
    assert.equal(key in body, true, `existing key ${key} must remain`);
  }
  // Redacted: neither the projects JSON nor the token-log key is echoed.
  assert.equal(JSON.stringify(body).includes(projectsJson), false);
  assert.equal(JSON.stringify(body).includes(tokenKey), false);
});

test("health/config reports postgresql only with the store selected and DATABASE_URL present", async () => {
  process.env.APP_ENV = "DEV";
  process.env.DATABASE_URL = "postgres://lg:lg@db.example.test:5432/learningguide";
  delete process.env.STUDY_GROUP_TOKEN_LOG_KEY;
  process.env.LIVEKIT_PROJECTS_JSON = JSON.stringify([{ id: "lg-prod", url: "wss://lg-prod.livekit.cloud", state: "active", credentialSecretId: "lg/livekit/prod" }]);
  process.env.STUDY_GROUP_STORE = "postgres";
  const postgresql = await (await healthConfig()).json() as { studyGroup: { store: string; configured: boolean } };
  assert.deepEqual(postgresql.studyGroup, { store: "postgresql", configured: false });
  // `filesystem` is the file store even when a database exists.
  process.env.STUDY_GROUP_STORE = "filesystem";
  const filesystem = await (await healthConfig()).json() as { studyGroup: { store: string; configured: boolean } };
  assert.deepEqual(filesystem.studyGroup, { store: "file", configured: false });
  // No DATABASE_URL means the file store regardless of the selected name.
  delete process.env.DATABASE_URL;
  process.env.STUDY_GROUP_STORE = "postgres";
  const noDatabase = await (await healthConfig()).json() as { studyGroup: { store: string; configured: boolean } };
  assert.deepEqual(noDatabase.studyGroup, { store: "file", configured: false });
});
