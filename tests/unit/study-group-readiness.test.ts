import assert from "node:assert/strict";
import { after, test } from "node:test";
import { GET as healthConfig } from "../../app/api/health/config/route";

// The studyGroup block on /api/health/config is the "code verifies the
// deployment" surface: the tutor key pool state, whether a DEV deployment is
// silently shadowing Secrets Manager with LIVEKIT_LOCAL_CREDENTIALS_JSON, and
// whether the fake gateway is on. All values stay redacted — nothing here may
// echo a key, a pool secret or the local-credentials JSON.

const keys = ["APP_ENV", "STUDY_GROUP_STORE", "DATABASE_URL", "LIVEKIT_PROJECTS_JSON", "STUDY_GROUP_TOKEN_LOG_KEY", "STUDY_GROUP_TUTOR_KEYS", "LIVEKIT_LOCAL_CREDENTIALS_JSON", "LIVEKIT_FAKE_GATEWAY"] as const;
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

test("the tutor key pool state is reported without echoing any key", async () => {
  process.env.APP_ENV = "DEV";
  delete process.env.STUDY_GROUP_STORE;
  delete process.env.DATABASE_URL;
  delete process.env.LIVEKIT_LOCAL_CREDENTIALS_JSON;
  delete process.env.LIVEKIT_FAKE_GATEWAY;
  process.env.LIVEKIT_PROJECTS_JSON = JSON.stringify([{ id: "lg-dev", url: "wss://lg-dev.livekit.cloud", state: "active", credentialSecretId: "lg/livekit/dev" }]);
  process.env.STUDY_GROUP_TOKEN_LOG_KEY = Buffer.alloc(32, 9).toString("base64");

  delete process.env.STUDY_GROUP_TUTOR_KEYS;
  assert.equal((await studyGroup()).tutorKeys, "missing");

  process.env.STUDY_GROUP_TUTOR_KEYS = "not-json";
  assert.equal((await studyGroup()).tutorKeys, "invalid");

  process.env.STUDY_GROUP_TUTOR_KEYS = JSON.stringify([{ id: "pool-1" }]);
  assert.equal((await studyGroup()).tutorKeys, "invalid");

  const pool = JSON.stringify([{ id: "pool-1", secret: "secret-value-never-echoed" }]);
  process.env.STUDY_GROUP_TUTOR_KEYS = pool;
  const configured = await studyGroup();
  assert.equal(configured.tutorKeys, "configured");
  assert.equal(JSON.stringify(configured).includes("secret-value-never-echoed"), false);
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
