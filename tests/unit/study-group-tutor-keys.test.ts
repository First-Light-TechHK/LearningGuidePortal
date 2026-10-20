import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

// Bug hunt 2026-10-14 (M4): the pool used to mark a key permanently
// unhealthy for the life of the process on any non-network failure, so a
// single 429 (or a spent quota) disabled AI Tutor in that environment until
// a restart. The contract this file now pins: rate_limited and quota are
// transient — the key rests for a cooldown and is retried — while
// auth_failed stays permanent, and within one execute() call a key is
// attempted at most once. The previous assertion set pinned the
// permanent-skip behaviour only implicitly (it never advanced a clock); the
// clock-injected tests below make the recovery contract explicit.

const FAKE_KEYS = [
  { id: "rate-limited", secret: "fake-key-rate-limited" },
  { id: "out-of-quota", secret: "fake-key-out-of-quota" },
  { id: "failed", secret: "fake-key-failed" },
  { id: "healthy", secret: "fake-key-healthy" }
] as const;

type KeyOutcome = "ok" | "failed" | "auth_failed" | "rate_limited" | "quota";

type KeyStats = { requests: number; errors: number; latencyMs: number };

type TutorKeyPool = {
  execute: (text: string) => Promise<{ keyId: string; body: string; log: string }>;
  stats: () => Record<string, KeyStats>;
};

type CreateTutorKeyPool = (input: {
  keys: Array<{ id: string; secret: string }>;
  call: (secret: string) => Promise<{ outcome: KeyOutcome; latencyMs: number; body?: string }>;
  now?: () => number;
}) => TutorKeyPool;

type PoolModule = {
  createTutorKeyPool?: CreateTutorKeyPool;
  TUTOR_KEY_COOLDOWN_MS?: Record<string, number>;
};

const MODULES = [
  "modules/group-study/tutorKeyPool.ts",
  "services/tutorKeyPool.ts"
];

async function loadPool(): Promise<PoolModule> {
  for (const relative of MODULES) {
    const file = path.join(process.cwd(), relative);
    if (!existsSync(file)) continue;
    const loaded = await import(pathToFileURL(file).href) as PoolModule;
    if (typeof loaded.createTutorKeyPool === "function") return loaded;
  }
  assert.fail("tutor key pool is missing: expected createTutorKeyPool in modules/group-study/tutorKeyPool.ts or services/tutorKeyPool.ts");
}

function outcomeFor(secret: string): KeyOutcome {
  if (secret === "fake-key-rate-limited") return "rate_limited";
  if (secret === "fake-key-out-of-quota") return "quota";
  if (secret === "fake-key-failed") return "failed";
  return "ok";
}

test("a failed, rate-limited, or out-of-quota tutor key is skipped for a healthy fake key", async () => {
  const calls: string[] = [];
  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("network");
  }) as typeof fetch;
  try {
    const { createTutorKeyPool } = await loadPool();
    assert.ok(createTutorKeyPool);
    const pool = createTutorKeyPool({
      keys: FAKE_KEYS.map((item) => ({ id: item.id, secret: item.secret })),
      call: async (secret) => {
        calls.push(secret);
        const outcome = outcomeFor(secret);
        return {
          outcome,
          latencyMs: outcome === "ok" ? 4 : 9,
          body: outcome === "ok" ? "queued" : undefined
        };
      }
    });
    const first = await pool.execute("first question");
    // Same clock instant: the limited keys are inside their cooldown window
    // (the recovery contract is pinned by the clock tests below) and yield to
    // the healthy key, exactly as the permanent-skip behaviour did before.
    const second = await pool.execute("second question");
    assert.equal(first.keyId, "healthy");
    assert.equal(second.keyId, "healthy");
    assert.equal(first.body, "queued");
    assert.deepEqual(calls.slice(0, 4), FAKE_KEYS.map((item) => item.secret));
    const stats = pool.stats();
    for (const key of FAKE_KEYS) {
      assert.equal(stats[key.id].requests >= 1, true, key.id);
      assert.equal(typeof stats[key.id].latencyMs, "number");
    }
    assert.equal(stats["rate-limited"].errors, stats["rate-limited"].requests);
    assert.equal(stats["out-of-quota"].errors, stats["out-of-quota"].requests);
    assert.equal(stats.failed.errors, stats.failed.requests);
    assert.equal(stats.healthy.errors, 0);
    assert.equal(stats.healthy.latencyMs >= 4, true);
    const published = `${first.log}\n${second.log}\n${JSON.stringify(first)}\n${JSON.stringify(second)}\n${JSON.stringify(stats)}`;
    for (const key of FAKE_KEYS) assert.equal(published.includes(key.secret), false);
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a rate-limited key is retried after its cooldown and recovers", async () => {
  const { createTutorKeyPool, TUTOR_KEY_COOLDOWN_MS } = await loadPool();
  assert.ok(createTutorKeyPool && TUTOR_KEY_COOLDOWN_MS);
  let clock = 0;
  let attempts = 0;
  const pool = createTutorKeyPool({
    keys: [{ id: "limited", secret: "fake-key-rate-limited" }],
    now: () => clock,
    call: async () => {
      attempts += 1;
      return attempts === 1
        ? { outcome: "rate_limited", latencyMs: 1 }
        : { outcome: "ok", latencyMs: 1, body: "back again" };
    }
  });
  assert.equal((await pool.execute("question one")).keyId, "", "the only key is rate-limited");
  assert.equal(attempts, 1);
  // Still inside the cooldown: the key is skipped, not re-attempted.
  clock = TUTOR_KEY_COOLDOWN_MS.rate_limited - 1;
  assert.equal((await pool.execute("question two")).keyId, "");
  assert.equal(attempts, 1);
  // Cooldown elapsed: the same key is attempted again and can serve traffic.
  clock = TUTOR_KEY_COOLDOWN_MS.rate_limited;
  const recovered = await pool.execute("question three");
  assert.equal(recovered.keyId, "limited");
  assert.equal(recovered.body, "back again");
  assert.equal(attempts, 2);
});

test("a quota-limited key rests longer than a rate-limited one", async () => {
  const { createTutorKeyPool, TUTOR_KEY_COOLDOWN_MS } = await loadPool();
  assert.ok(createTutorKeyPool && TUTOR_KEY_COOLDOWN_MS);
  assert.equal(TUTOR_KEY_COOLDOWN_MS.quota > TUTOR_KEY_COOLDOWN_MS.rate_limited, true);
  let clock = 0;
  let attempts = 0;
  const pool = createTutorKeyPool({
    keys: [{ id: "quota", secret: "fake-key-out-of-quota" }],
    now: () => clock,
    call: async () => {
      attempts += 1;
      return attempts === 1
        ? { outcome: "quota", latencyMs: 1 }
        : { outcome: "ok", latencyMs: 1, body: "quota restored" };
    }
  });
  assert.equal((await pool.execute("question one")).keyId, "");
  // Past the rate-limit cooldown the quota key still rests.
  clock = TUTOR_KEY_COOLDOWN_MS.rate_limited;
  assert.equal((await pool.execute("question two")).keyId, "");
  assert.equal(attempts, 1);
  // Past its own, longer cooldown it is retried.
  clock = TUTOR_KEY_COOLDOWN_MS.quota;
  assert.equal((await pool.execute("question three")).keyId, "quota");
  assert.equal(attempts, 2);
});

test("an auth-failed key stays permanently out even after a long wait", async () => {
  const { createTutorKeyPool } = await loadPool();
  assert.ok(createTutorKeyPool);
  let clock = 0;
  let attempts = 0;
  const pool = createTutorKeyPool({
    keys: [{ id: "wrong-key", secret: "fake-key-auth-failed" }],
    now: () => clock,
    call: async () => {
      attempts += 1;
      return { outcome: "auth_failed", latencyMs: 1 };
    }
  });
  assert.equal((await pool.execute("question one")).keyId, "");
  clock = 24 * 60 * 60 * 1000;
  assert.equal((await pool.execute("question two")).keyId, "");
  assert.equal(attempts, 1, "an authenticated rejection is never retried in-process");
});

test("one execute call attempts each key at most once", async () => {
  const { createTutorKeyPool } = await loadPool();
  assert.ok(createTutorKeyPool);
  const calls: string[] = [];
  const pool = createTutorKeyPool({
    keys: [
      { id: "limited", secret: "fake-key-rate-limited" },
      { id: "healthy", secret: "fake-key-healthy" }
    ],
    call: async (secret) => {
      calls.push(secret);
      return outcomeFor(secret) === "ok"
        ? { outcome: "ok", latencyMs: 1, body: "queued" }
        : { outcome: "rate_limited", latencyMs: 1 };
    }
  });
  const result = await pool.execute("question");
  assert.equal(result.keyId, "healthy");
  assert.deepEqual(calls, ["fake-key-rate-limited", "fake-key-healthy"]);
});
