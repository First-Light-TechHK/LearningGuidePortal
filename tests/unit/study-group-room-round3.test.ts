import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createSeatIntents, SEAT_INTENT_LEFT, type SeatAnswer, type SeatIntent } from "../../modules/group-study/seatIntents";

// The room client fixes of the third QA review of the Live Session room
// (QA3, 2026-10-20, F1-F10): behaviour of the pure helpers the room now decides with, plus
// source locks for the wiring that has no helper to call.

const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");

function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, end);
  return source.slice(from, to);
}

const OK: SeatAnswer<unknown> = { ok: true, code: "ok", message: "", data: { seated: true } };

// A fake server: records what was sent and when, and answers on demand.
function fakeSeatServer() {
  const sent: SeatIntent[] = [];
  const pending: Array<{ intent: SeatIntent; signal: AbortSignal; answer: (value: SeatAnswer<unknown>) => void }> = [];
  const send = (intent: SeatIntent, signal: AbortSignal) => new Promise<SeatAnswer<unknown>>((resolve) => {
    sent.push(intent);
    pending.push({ intent, signal, answer: resolve });
  });
  return { sent, pending, send };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("QA3 F5: a Leave sent while an entry is on its way goes out only after that entry is answered", async () => {
  const server = fakeSeatServer();
  let left = false;
  const seatIntent = createSeatIntents({ send: server.send, hasLeft: () => left });
  const entry = seatIntent("enter");
  await tick();
  assert.deepEqual(server.sent, ["enter"]);
  left = true;
  const leave = seatIntent("leave");
  await tick();
  assert.deepEqual(server.sent, ["enter"], "the leave waits: the server must not take it before the entry");
  server.pending[0].answer(OK);
  assert.equal((await entry).ok, true);
  await tick();
  assert.deepEqual(server.sent, ["enter", "leave"]);
  server.pending[1].answer(OK);
  assert.equal((await leave).ok, true);
});

test("QA3 F1 / F5: once the page has left, no entry or renewal goes out, while another Leave still does", async () => {
  const server = fakeSeatServer();
  let left = false;
  const seatIntent = createSeatIntents({ send: server.send, hasLeft: () => left });
  // A renewal queued behind a leave is decided when its turn comes, not when it was asked.
  const leave = seatIntent("leave");
  left = true;
  const renewal = seatIntent("heartbeat");
  const entry = seatIntent("enter");
  await tick();
  server.pending[0].answer(OK);
  await leave;
  assert.deepEqual(await renewal, { ok: false, code: SEAT_INTENT_LEFT, message: "", data: null });
  assert.equal((await entry).code, SEAT_INTENT_LEFT);
  const again = seatIntent("leave");
  await tick();
  assert.deepEqual(server.sent, ["leave", "leave"]);
  server.pending[1].answer(OK);
  assert.equal((await again).ok, true);
});

test("QA3 F3: a stalled request gives up as a network failure and frees the next intent", async () => {
  const server = fakeSeatServer();
  const seatIntent = createSeatIntents({ send: server.send, hasLeft: () => false, timeoutMs: 20 });
  const stalled = seatIntent("heartbeat");
  const next = seatIntent("heartbeat");
  assert.deepEqual(await stalled, { ok: false, code: "network", message: "", data: null });
  assert.equal(server.pending[0].signal.aborted, true, "the stalled fetch is aborted");
  await tick();
  assert.deepEqual(server.sent, ["heartbeat", "heartbeat"]);
  server.pending[1].answer(OK);
  assert.equal((await next).ok, true);
});

test("QA3 F3: a send that throws answers as a network failure and the queue goes on", async () => {
  let calls = 0;
  const seatIntent = createSeatIntents({
    send: async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return OK;
    },
    hasLeft: () => false
  });
  assert.equal((await seatIntent("heartbeat")).code, "network");
  assert.equal((await seatIntent("heartbeat")).ok, true);
});

test("QA3 F1 / F3 / F5: every seat intent of the room goes through the one queue that knows the page has left", () => {
  assert.equal(/studyGroupRequest[^\n]*\/(enter|heartbeat|leave)`/.test(room), false);
  assert.equal((room.match(/seatIntent\("enter"\)/g) || []).length, 3, "entry, re-entry and connect");
  assert.match(room, /const result = await seatIntent\("leave"\);/);
  const beat = between(room, "const beat = async () => {", "const timer = window.setInterval");
  assert.match(beat, /if \(heartbeatBusy\.current \|\| leftRef\.current\) return;/);
  assert.match(beat, /await seatIntent<\{ seated: boolean \}>\("heartbeat"\);/);
});
