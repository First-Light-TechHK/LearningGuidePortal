import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const FAKE_KEYS = [
  { id: "rate-limited", secret: "fake-key-rate-limited" },
  { id: "out-of-quota", secret: "fake-key-out-of-quota" },
  { id: "failed", secret: "fake-key-failed" },
  { id: "healthy", secret: "fake-key-healthy" }
] as const;

type KeyOutcome = "ok" | "failed" | "rate_limited" | "quota";

type KeyStats = { requests: number; errors: number; latencyMs: number };

type TutorKeyPool = {
  execute: (text: string) => Promise<{ keyId: string; body: string; log: string }>;
  stats: () => Record<string, KeyStats>;
};

type CreateTutorKeyPool = (input: {
  keys: Array<{ id: string; secret: string }>;
  call: (secret: string) => Promise<{ outcome: KeyOutcome; latencyMs: number; body?: string }>;
}) => TutorKeyPool;

const MODULES = [
  "modules/group-study/tutorKeyPool.ts",
  "services/tutorKeyPool.ts"
];

async function loadPool(): Promise<CreateTutorKeyPool> {
  for (const relative of MODULES) {
    const file = path.join(process.cwd(), relative);
    if (!existsSync(file)) continue;
    const loaded = await import(pathToFileURL(file).href) as { createTutorKeyPool?: CreateTutorKeyPool };
    if (typeof loaded.createTutorKeyPool === "function") return loaded.createTutorKeyPool;
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
    const createTutorKeyPool = await loadPool();
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
