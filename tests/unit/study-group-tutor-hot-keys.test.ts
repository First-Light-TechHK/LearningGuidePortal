import assert from "node:assert/strict";
import { test } from "node:test";
import { createTutorKeySource } from "../../services/tutorKeySource";

// The Live Session tutor's LLM keys are hot: read from Secrets Manager at run
// time, re-read at most once a minute or at once on demand, so adding,
// removing or rotating a key needs no redeploy.

function fakeSecret(initial: string | undefined) {
  const state = { value: initial, reads: 0, fail: false };
  return {
    state,
    reader: {
      async getSecretValue(id: string) {
        assert.equal(id, "lg-dev-studygroup-tutor-keys");
        state.reads += 1;
        if (state.fail) throw new Error("AccessDenied");
        return state.value;
      }
    }
  };
}

test("a key added or rotated in the secret is used within the cache window, or at once on a forced read", async () => {
  let clock = 0;
  const secret = fakeSecret(JSON.stringify([{ id: "k1", secret: "one" }]));
  const source = createTutorKeySource({ reader: secret.reader, secretId: "lg-dev-studygroup-tutor-keys", env: {}, now: () => clock, cacheTtlMs: 60_000 });

  assert.deepEqual(await source.keys(), [{ id: "k1", secret: "one" }]);
  assert.equal(source.source(), "secret");

  secret.state.value = JSON.stringify([{ id: "k1", secret: "one" }, { id: "k2", secret: "two" }]);
  clock = 30_000;
  assert.deepEqual(await source.keys(), [{ id: "k1", secret: "one" }], "cached inside the window");
  assert.equal(secret.state.reads, 1);
  clock = 60_000;
  assert.deepEqual(await source.keys(), [{ id: "k1", secret: "one" }, { id: "k2", secret: "two" }], "re-read after the window");

  secret.state.value = JSON.stringify([{ id: "k3", secret: "three" }]);
  assert.deepEqual(await source.keys({ forceRefresh: true }), [{ id: "k3", secret: "three" }], "a forced read sees the rotation at once");
});

test("concurrent reads share one Secrets Manager call", async () => {
  const secret = fakeSecret(JSON.stringify([{ id: "k1", secret: "one" }]));
  const source = createTutorKeySource({ reader: secret.reader, secretId: "lg-dev-studygroup-tutor-keys", env: {} });
  await Promise.all([source.keys(), source.keys(), source.keys({ forceRefresh: true })]);
  assert.equal(secret.state.reads, 1);
});

test("a failed or empty read keeps the last good pool; with none yet, the environment pool answers", async () => {
  let clock = 0;
  const secret = fakeSecret(JSON.stringify([{ id: "k1", secret: "one" }]));
  const env = { STUDY_GROUP_TUTOR_KEYS: JSON.stringify([{ id: "env", secret: "env-key" }]) };
  const source = createTutorKeySource({ reader: secret.reader, secretId: "lg-dev-studygroup-tutor-keys", env, now: () => clock, cacheTtlMs: 60_000 });
  assert.deepEqual(await source.keys(), [{ id: "k1", secret: "one" }]);

  secret.state.fail = true;
  clock = 120_000;
  assert.deepEqual(await source.keys(), [{ id: "k1", secret: "one" }], "AWS error keeps the last good pool");
  secret.state.fail = false;
  secret.state.value = "[]";
  assert.deepEqual(await source.keys({ forceRefresh: true }), [{ id: "k1", secret: "one" }], "an emptied secret keeps the last good pool");

  const cold = createTutorKeySource({ reader: fakeSecret(undefined).reader, secretId: "lg-dev-studygroup-tutor-keys", env });
  assert.deepEqual(await cold.keys(), [{ id: "env", secret: "env-key" }]);
  assert.equal(cold.source(), "own");
});

test("without a secret id the environment decides: own pool, then the site's OpenRouter key, then none", async () => {
  assert.deepEqual(await createTutorKeySource({ reader: null, env: { STUDY_GROUP_TUTOR_KEYS: JSON.stringify([{ id: "a", secret: "s" }]) } }).keys(), [{ id: "a", secret: "s" }]);
  const shared = createTutorKeySource({ reader: null, env: { OPENROUTER_API_KEY: "site-key" } });
  assert.deepEqual(await shared.keys(), [{ id: "openrouter-shared", secret: "site-key" }]);
  assert.equal(shared.source(), "shared");
  assert.equal(createTutorKeySource({ reader: null, env: {} }).source(), "none");
});

test("a failed read with no pool yet is not repeated by every caller inside the cache window (final review 1)", async () => {
  let clock = 0;
  const secret = fakeSecret(undefined);
  secret.state.fail = true;
  const source = createTutorKeySource({ reader: secret.reader, secretId: "lg-dev-studygroup-tutor-keys", env: { OPENROUTER_API_KEY: "site-key" }, now: () => clock, cacheTtlMs: 60_000 });
  assert.deepEqual(await source.keys(), [{ id: "openrouter-shared", secret: "site-key" }]);
  await source.keys();
  await source.keys();
  assert.equal(secret.state.reads, 1, "one read per window");
  await source.keys({ forceRefresh: true });
  assert.equal(secret.state.reads, 2, "a forced read still goes through");
  secret.state.fail = false;
  secret.state.value = JSON.stringify([{ id: "k1", secret: "one" }]);
  clock += 60_000;
  assert.deepEqual(await source.keys(), [{ id: "k1", secret: "one" }], "retried after the window");
});
