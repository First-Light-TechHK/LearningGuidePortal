import assert from "node:assert/strict";
import { after, test } from "node:test";
import { GET as healthConfig } from "../../app/api/health/config/route";

// The studyGroup block on /api/health/config is the "code verifies the
// deployment" surface: whether the room's Tutor is forwarded to
// KnowledgeSystem (which owns its prompt, model, keys and quota), whether a DEV
// deployment is silently shadowing Secrets Manager with
// LIVEKIT_LOCAL_CREDENTIALS_JSON, whether the fake gateway is on, and where the
// LiveKit project list comes from. All values stay redacted — nothing here may
// echo a key, a pool secret or the local-credentials JSON.

const keys = ["APP_ENV", "STUDY_GROUP_STORE", "DATABASE_URL", "LIVEKIT_PROJECTS_JSON", "LIVEKIT_PROJECTS_SECRET_ID", "STUDY_GROUP_TOKEN_LOG_KEY", "KS_TUTOR_BASE_URL", "LIVEKIT_LOCAL_CREDENTIALS_JSON", "LIVEKIT_FAKE_GATEWAY"] as const;
const saved = new Map(keys.map((key) => [key, process.env[key]]));

after(() => {
  for (const key of keys) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function studyGroup() {
  const body = await (await healthConfig()).json() as { studyGroup: Record<string, unknown> };
  return body.studyGroup;
}

test("the room Tutor is reported as KS-owned, and nothing KS owns is echoed here", async () => {
  process.env.APP_ENV = "DEV";
  delete process.env.STUDY_GROUP_STORE;
  delete process.env.DATABASE_URL;
  delete process.env.LIVEKIT_LOCAL_CREDENTIALS_JSON;
  delete process.env.LIVEKIT_FAKE_GATEWAY;
  process.env.LIVEKIT_PROJECTS_JSON = JSON.stringify([{ id: "lg-dev", url: "wss://lg-dev.livekit.cloud", state: "active", credentialSecretId: "lg/livekit/dev" }]);
  process.env.STUDY_GROUP_TOKEN_LOG_KEY = Buffer.alloc(32, 9).toString("base64");

  delete process.env.KS_TUTOR_BASE_URL;
  assert.equal((await studyGroup()).tutorSource, "none");

  process.env.KS_TUTOR_BASE_URL = "http://ks.internal:3000";
  const configured = await studyGroup();
  assert.equal(configured.tutorSource, "ks");
  assert.equal(JSON.stringify(configured).includes("ks.internal"), false);
});

test("a DEV deployment with local LiveKit credentials or the fake gateway says so", async () => {
  process.env.APP_ENV = "DEV";
  delete process.env.STUDY_GROUP_STORE;
  delete process.env.DATABASE_URL;
  delete process.env.STUDY_GROUP_TUTOR_KEYS;
  process.env.LIVEKIT_PROJECTS_JSON = JSON.stringify([{ id: "lg-dev", url: "wss://lg-dev.livekit.cloud", state: "active", credentialSecretId: "lg/livekit/dev" }]);
  process.env.STUDY_GROUP_TOKEN_LOG_KEY = Buffer.alloc(32, 9).toString("base64");

  delete process.env.LIVEKIT_LOCAL_CREDENTIALS_JSON;
  delete process.env.LIVEKIT_FAKE_GATEWAY;
  let block = await studyGroup();
  assert.equal(block.credentialSource, "secrets-manager");
  assert.equal(block.simulated, false);

  const localJson = JSON.stringify({ "lg-dev": { apiKey: "local-key-never-echoed", apiSecret: "local-secret-never-echoed" } });
  process.env.LIVEKIT_LOCAL_CREDENTIALS_JSON = localJson;
  process.env.LIVEKIT_FAKE_GATEWAY = "1";
  block = await studyGroup();
  assert.equal(block.credentialSource, "local");
  assert.equal(block.simulated, true);
  assert.equal(JSON.stringify(block).includes("local-secret-never-echoed"), false);
  assert.equal(JSON.stringify(block).includes(localJson), false);
});

test("the LiveKit project list source is reported without echoing the secret id or the list", async () => {
  process.env.APP_ENV = "DEV";
  delete process.env.STUDY_GROUP_STORE;
  delete process.env.DATABASE_URL;
  delete process.env.LIVEKIT_LOCAL_CREDENTIALS_JSON;
  delete process.env.LIVEKIT_FAKE_GATEWAY;
  process.env.STUDY_GROUP_TOKEN_LOG_KEY = Buffer.alloc(32, 9).toString("base64");
  const projectsJson = JSON.stringify([{ id: "lg-dev", url: "wss://lg-dev.livekit.cloud", state: "active", credentialSecretId: "lg/livekit/dev" }]);

  delete process.env.LIVEKIT_PROJECTS_SECRET_ID;
  delete process.env.LIVEKIT_PROJECTS_JSON;
  let block = await studyGroup();
  assert.equal(block.liveKitProjectsSource, "none");
  assert.equal(block.configured, false);

  process.env.LIVEKIT_PROJECTS_JSON = projectsJson;
  block = await studyGroup();
  assert.equal(block.liveKitProjectsSource, "env");
  assert.equal(block.configured, true);

  // The secret wins over the inline JSON, as the runtime picks it.
  process.env.LIVEKIT_PROJECTS_SECRET_ID = "lg/livekit/projects-never-echoed";
  block = await studyGroup();
  assert.equal(block.liveKitProjectsSource, "secret");
  assert.equal(block.configured, true);
  delete process.env.LIVEKIT_PROJECTS_JSON;
  block = await studyGroup();
  assert.equal(block.liveKitProjectsSource, "secret");
  assert.equal(block.configured, true);
  assert.equal(JSON.stringify(block).includes("projects-never-echoed"), false);
  assert.equal(JSON.stringify(block).includes("lg-dev"), false);
});
