import assert from "node:assert/strict";
import test from "node:test";
import { createTicketQueue, type QueueTimer } from "../../modules/group-study/ticketQueue";

// Nothing here depends on how fast anything runs: every preparation and timer is
// released by hand, so each order below happens the same way on every run.
function held<T = void>() {
  let release!: (value: T) => void, fail!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => { release = resolve; fail = reject; });
  return { promise, release, fail };
}

function manualTimers() {
  const timers: Array<{ fire: () => void; cancelled: boolean }> = [];
  return {
    timers,
    timer: (): QueueTimer => {
      const gate = held();
      const entry = { fire: () => gate.release(), cancelled: false };
      timers.push(entry);
      return { elapsed: gate.promise, cancel: () => { entry.cancelled = true; } };
    },
  };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

function queueWithLog() {
  const clock = manualTimers();
  const queue = createTicketQueue({ maxPrepareMs: 1, timer: clock.timer });
  const log: string[] = [];
  const job = (name: string) => async () => { log.push(name); return name; };
  return { clock, queue, log, job };
}

test("work runs in the order received, whoever's preparation finishes first", async () => {
  const { queue, log, job } = queueWithLog();
  const [a, b, c] = [held(), held(), held()];
  const results = [queue.enter("s", () => a.promise, job("a")), queue.enter("s", () => b.promise, job("b")), queue.enter("s", () => c.promise, job("c"))];
  c.release(); b.release(); await settled();
  assert.deepEqual(log, [], "nothing runs before the first in line is ready");
  a.release();
  assert.deepEqual(await Promise.all(results), ["a", "b", "c"]);
  assert.deepEqual(log, ["a", "b", "c"]);
});

test("preparations run side by side, the work one at a time", async () => {
  const { queue, log } = queueWithLog();
  const prepared: string[] = [];
  const firstRun = held<string>();
  const first = queue.enter("s", async () => { prepared.push("a"); }, () => { log.push("a"); return firstRun.promise; });
  const second = queue.enter("s", async () => { prepared.push("b"); }, async () => { log.push("b"); return "b"; });
  assert.deepEqual(prepared, ["a", "b"], "both preparations started at once");
  await settled();
  assert.deepEqual(log, ["a"], "the second waits for the first to finish");
  firstRun.release("a");
  assert.deepEqual(await Promise.all([first, second]), ["a", "b"]);
});

test("a failed preparation rejects only its own caller and never runs", async () => {
  const { queue, log, job } = queueWithLog();
  const earlier = held();
  const first = queue.enter("s", () => earlier.promise, job("a"));
  const second = queue.enter("s", async () => undefined, job("b"));
  earlier.fail(new Error("no access"));
  await assert.rejects(first, /no access/);
  assert.equal(await second, "b");
  assert.deepEqual(log, ["b"]);
});

test("failing work rejects only its own caller; the queue goes on", async () => {
  const { queue, job } = queueWithLog();
  const first = queue.enter("s", async () => undefined, async () => { throw new Error("write failed"); });
  const second = queue.enter("s", async () => undefined, job("b"));
  await assert.rejects(first, /write failed/);
  assert.equal(await second, "b");
});

test("a hung preparation holds later callers only until its own time is up, and not those after", async () => {
  const { clock, queue, log, job } = queueWithLog();
  const hung = held();
  const first = queue.enter("s", () => hung.promise, job("hung"));
  const second = queue.enter("s", async () => undefined, job("b"));
  await settled();
  assert.deepEqual(log, [], "still in line behind the first");
  clock.timers[0].fire();
  assert.equal(await second, "b");
  // Received after the wait ran out: goes straight in, no timer has to fire for it.
  assert.equal(await queue.enter("s", async () => undefined, job("c")), "c");
  assert.deepEqual(log, ["b", "c"]);
  // The slow caller is not lost: it rejoins at the back.
  hung.release();
  assert.equal(await first, "hung");
  assert.deepEqual(log, ["b", "c", "hung"]);
});

test("a preparation that fails after its time is up still answers its caller", async () => {
  const { clock, queue } = queueWithLog();
  const hung = held();
  const first = queue.enter("s", () => hung.promise, async () => "never");
  clock.timers[0].fire();
  await settled();
  hung.fail(new Error("no access"));
  await assert.rejects(first, /no access/);
});

test("a key never waits for another key", async () => {
  const { queue, job } = queueWithLog();
  const stuck = held();
  void queue.enter("room-a", () => stuck.promise, job("a"));
  assert.equal(await queue.enter("room-b", async () => undefined, job("b")), "b");
  stuck.release();
});

test("nothing is left behind, hung preparation included", async () => {
  const { clock, queue, job } = queueWithLog();
  const never = new Promise<void>(() => undefined);
  void queue.enter("s", () => never, job("hung"));
  assert.equal(queue.size(), 1);
  clock.timers[0].fire();
  await settled();
  assert.equal(queue.size(), 0, "a hung preparation does not keep its key");
  await queue.enter("t", async () => undefined, job("t"));
  await settled();
  assert.equal(queue.size(), 0);
  assert.equal(clock.timers[1].cancelled, true, "a preparation that finished in time cancels its timer");
});

test("real timers: a preparation that outlasts maxPrepareMs gives up its place", async () => {
  const queue = createTicketQueue({ maxPrepareMs: 1 });
  const never = new Promise<void>(() => undefined);
  void queue.enter("s", () => never, async () => "hung");
  assert.equal(await queue.enter("s", async () => undefined, async () => "next"), "next");
});
