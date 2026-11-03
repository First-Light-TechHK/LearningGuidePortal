// Persistence review 2026-11-03: the local (file) Helpdesk repository must
// honour the same tryRateHit and findAssistByKey contract as the PostgreSQL
// one. The rate-hit sequence below is the one
// tests/io/postgres/helpdesk-repository.test.ts runs against PostgreSQL ("M2
// contract"); the outcomes must match line for line.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";
import type { AssistRecord, HelpdeskRepository } from "../../modules/helpdesk/repository";

const RATE_AT = "2026-10-28T06:00:00.000Z";
const HOUR = 3_600_000;
const plus = (ms: number) => new Date(Date.parse(RATE_AT) + ms).toISOString();

let root: string;
before(async () => { root = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-rate-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

function repository(): HelpdeskRepository {
  return createLocalHelpdeskRepository(path.join(root, randomUUID()));
}

test("tryRateHit (local): limit reached vs exceeded, the window closes at exactly windowMs, keys are isolated, a key never holds more than `limit` hits", async () => {
  const repo = repository();
  assert.deepEqual(await repo.tryRateHit("k:a", 3, HOUR, RATE_AT), { allowed: true });
  assert.deepEqual(await repo.tryRateHit("k:a", 3, HOUR, plus(10 * 60_000)), { allowed: true });
  assert.deepEqual(await repo.tryRateHit("k:a", 3, HOUR, plus(20 * 60_000)), { allowed: true }, "the limit is reached, not exceeded: the third is admitted");
  assert.deepEqual(await repo.tryRateHit("k:a", 3, HOUR, plus(30 * 60_000)), { allowed: false, oldestAt: RATE_AT }, "the fourth exceeds it");
  assert.deepEqual(await repo.tryRateHit("k:a", 3, HOUR, plus(HOUR - 1)), { allowed: false, oldestAt: RATE_AT }, "1 ms inside the window the oldest hit still counts");
  assert.deepEqual(await repo.tryRateHit("k:b", 1, HOUR, plus(30 * 60_000)), { allowed: true }, "another key is unaffected by a full one");
  assert.deepEqual(await repo.tryRateHit("k:b", 1, HOUR, plus(31 * 60_000)), { allowed: false, oldestAt: plus(30 * 60_000) });
  assert.deepEqual(await repo.tryRateHit("k:a", 3, HOUR, plus(HOUR)), { allowed: true }, "exactly windowMs after the oldest hit it is outside the window");
  assert.deepEqual(await repo.tryRateHit("k:a", 3, HOUR, plus(HOUR + 1)), { allowed: false, oldestAt: plus(10 * 60_000) });
  // Per-key bound, like PostgreSQL: a burst far beyond the limit admits exactly `limit`, a later burst inside the window none.
  const burst = await Promise.all(Array.from({ length: 45 }, () => repo.tryRateHit("k:burst", 30, HOUR, RATE_AT)));
  assert.equal(burst.filter((item) => item.allowed).length, 30, "40+ concurrent attempts admit exactly the limit");
  const later = await Promise.all(Array.from({ length: 45 }, () => repo.tryRateHit("k:burst", 30, HOUR, plus(30 * 60_000))));
  assert.equal(later.filter((item) => item.allowed).length, 0);
  assert.deepEqual(await repo.tryRateHit("k:burst", 30, HOUR, plus(HOUR)), { allowed: true }, "and the whole burst leaves the window together");
});

test("findAssistByKey (local): per learner while the key stays unique: the other learner finds nothing under my key and cannot store a row under it", async () => {
  const repo = repository();
  const key = randomUUID();
  const record = (id: string, learnerId: string): AssistRecord => ({
    id, learnerId, source: "chat", locale: "en-GB", question: "password", faqId: null, faqQuestion: null, answer: null, feedback: null, ticketId: null,
    clientEventId: key, payloadHash: "a".repeat(64), createdAt: RATE_AT, feedbackDeliveredAt: null, feedbackAttemptedAt: null, alternatives: []
  });
  assert.equal(await repo.insertAssist(record("mine", "learner")), "inserted");
  assert.equal(await repo.insertAssist(record("theirs", "other")), "duplicate", "the key is unique across learners");
  assert.equal(await repo.findAssistByKey(key, "other"), null);
  assert.equal((await repo.findAssistByKey(key, "learner"))?.id, "mine");
  assert.equal(await repo.findAssist("theirs"), null, "nothing was stored for the other learner");
});

test("tryRateHit (local): limit 0 refuses every attempt and stores nothing; sweepRateHits deletes only hits older than the cutoff, oldest first, at most `limit`", async () => {
  const repo = repository();
  assert.deepEqual(await repo.tryRateHit("k:zero", 0, HOUR, RATE_AT), { allowed: false, oldestAt: RATE_AT }, "nothing to wait for: retry 'now'");
  assert.deepEqual(await repo.tryRateHit("k:zero", 0, HOUR, plus(1)), { allowed: false, oldestAt: plus(1) });
  // Hits of three keys at three ages; the sweep cutoff sits between them.
  assert.deepEqual(await repo.tryRateHit("k:old", 5, HOUR, RATE_AT), { allowed: true });
  assert.deepEqual(await repo.tryRateHit("k:old", 5, HOUR, plus(1)), { allowed: true });
  assert.deepEqual(await repo.tryRateHit("k:mid", 5, HOUR, plus(2 * HOUR)), { allowed: true });
  assert.deepEqual(await repo.tryRateHit("k:new", 5, HOUR, plus(30 * HOUR)), { allowed: true });
  assert.equal(await repo.sweepRateHits(plus(24 * HOUR), 1), 1, "bounded: one of the three stale hits");
  assert.equal(await repo.sweepRateHits(plus(24 * HOUR), 10), 2, "the remaining stale hits");
  assert.equal(await repo.sweepRateHits(plus(24 * HOUR), 10), 0, "the hit inside a day is kept");
  assert.deepEqual(await repo.tryRateHit("k:new", 1, HOUR, plus(30 * HOUR + 1)), { allowed: false, oldestAt: plus(30 * HOUR) }, "the kept hit still counts");
  assert.deepEqual(await repo.tryRateHit("k:old", 1, HOUR, plus(30 * HOUR + 1)), { allowed: true }, "the swept key starts clean");
});

test("peekRateHit (local) decides like tryRateHit without recording; assistKeyOwner names who used a key", async () => {
  const repo = repository();
  assert.deepEqual(await repo.peekRateHit("k:p", 2, HOUR, RATE_AT), { allowed: true });
  assert.deepEqual(await repo.peekRateHit("k:p", 2, HOUR, RATE_AT), { allowed: true }, "a peek records nothing");
  assert.deepEqual(await repo.tryRateHit("k:p", 2, HOUR, RATE_AT), { allowed: true });
  assert.deepEqual(await repo.tryRateHit("k:p", 2, HOUR, plus(1)), { allowed: true });
  assert.deepEqual(await repo.peekRateHit("k:p", 2, HOUR, plus(2)), { allowed: false, oldestAt: RATE_AT });
  assert.deepEqual(await repo.peekRateHit("k:p", 2, HOUR, plus(HOUR)), { allowed: true }, "the oldest hit left the window");
  assert.deepEqual(await repo.peekRateHit("k:p", 0, HOUR, plus(2)), { allowed: false, oldestAt: RATE_AT });
  const key = randomUUID();
  const row: AssistRecord = {
    id: "owner-row", learnerId: "user-a", source: "chat", locale: "en-GB", question: "password", faqId: null, faqQuestion: null, answer: null, feedback: null, ticketId: null,
    clientEventId: key, payloadHash: "a".repeat(64), createdAt: RATE_AT, feedbackDeliveredAt: null, feedbackAttemptedAt: null, alternatives: []
  };
  assert.equal(await repo.assistKeyOwner(key), null);
  assert.equal(await repo.insertAssist(row), "inserted");
  assert.equal(await repo.assistKeyOwner(key), "user-a");
});
