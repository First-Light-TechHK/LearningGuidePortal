import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { after, test } from "node:test";

// The health checks App Runner probes must not hang on the tutor's key secret
// (final review 1): a stalled Secrets Manager read is cut off after a second,
// and the health surface reports the fallback pool meanwhile. Own file, so the
// process-wide key source is created with this environment.

const sockets: Socket[] = [];
const stalled = createServer((socket) => { sockets.push(socket); });

after(() => {
  for (const socket of sockets) socket.destroy();
  stalled.close();
});

test("a stalled tutor key secret does not hold up /api/health/config", async () => {
  await new Promise<void>((resolve) => stalled.listen(0, "127.0.0.1", resolve));
  const address = stalled.address();
  assert.ok(address && typeof address === "object");
  Object.assign(process.env, {
    APP_ENV: "DEV",
    AWS_REGION: "eu-west-2",
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    AWS_ENDPOINT_URL_SECRETS_MANAGER: `http://127.0.0.1:${address.port}`,
    STUDY_GROUP_TUTOR_KEYS_SECRET_ID: "lg-dev-studygroup-tutor-keys",
    OPENROUTER_API_KEY: "site-key"
  });
  delete process.env.STUDY_GROUP_TUTOR_KEYS;
  delete process.env.STUDY_GROUP_TUTOR_URL;
  const { GET } = await import("../../app/api/health/config/route");

  const started = Date.now();
  const body = await (await GET()).json() as { studyGroup: { tutorKeySource: string } };
  assert.ok(Date.now() - started < 2_000, `answered in ${Date.now() - started} ms`);
  assert.equal(body.studyGroup.tutorKeySource, "shared");
  assert.doesNotMatch(JSON.stringify(body), /site-key/);
});
