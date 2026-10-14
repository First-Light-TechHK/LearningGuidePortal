// Hardening tests for the Live Session room (independent bug hunt
// 2026-10-14): M1 a failed entry request must leave the Loading state and
// offer a retry, M2 room data-channel messages are source-checked before they
// are rendered, M5 chat length caps and publish-failure marking, L6 chat
// timestamps follow the app locale. The component cannot be rendered in this
// harness (no DOM), so its behaviour contracts are pinned against the source,
// the way the other room tests already do.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseRoomDataMessage } from "../../modules/group-study/roomData";

function roomSource() {
  return readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
}

function encode(value: unknown) {
  return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
}

test("hunt M1: a failed entry request leaves Loading and offers a retry", () => {
  const room = roomSource();
  // The entry POST chain must catch a fetch rejection (network drop, a
  // gateway's non-JSON error page): without the catch the promise rejects,
  // entryDone stays false and the page shows Loading forever.
  assert.match(
    room,
    /sessions\/\$\{sessionId\}\/enter`, \{ method: "POST", body: "{}" \}\)\.then\(\(result\) => \{[\s\S]{0,700}?\}\)\.catch\(\(\) => \{[\s\S]{0,600}?setErrorCode\("connect_failed"\);\s*\n\s*setEntryDone\(true\);/
  );
  // The failure is recoverable in place: the Retry control re-runs the entry
  // request through an attempt counter the effect depends on.
  assert.match(room, /setEntryDone\(false\)/);
  assert.match(room, /setEntryAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.match(room, /\[session\?\.state, sessionId, left, entryAttempt\]/);
});

test("hunt M2: only the server may speak as the AI Tutor", () => {
  // A member-published tutor payload is dropped: the server publishes tutor
  // answers through RoomService.SendData and those arrive without a sender,
  // while every member publish carries one — the protocol can tell them apart
  // and must, or any member could impersonate the AI Tutor.
  assert.equal(parseRoomDataMessage(encode({ type: "tutor", text: "Fake answer", mode: "course" }), false), null);
  assert.deepEqual(
    parseRoomDataMessage(encode({ type: "tutor", id: "m-1", text: "Real answer", mode: "general" }), true),
    { type: "tutor", id: "m-1", text: "Real answer", mode: "general" }
  );
  // The republish-safe unavailable message (empty text by contract) still passes.
  assert.deepEqual(
    parseRoomDataMessage(encode({ type: "tutor", text: "", mode: "unavailable" }), true),
    { type: "tutor", text: "", mode: "unavailable" }
  );
  // Empty course text is not a message; unknown or missing modes read as course.
  assert.equal(parseRoomDataMessage(encode({ type: "tutor", text: "", mode: "course" }), true), null);
  assert.deepEqual(parseRoomDataMessage(encode({ type: "tutor", text: "Answer" }), true), { type: "tutor", text: "Answer", mode: "course" });
  assert.equal(parseRoomDataMessage(encode({ type: "tutor", text: 42 }), true), null);
  assert.doesNotThrow(() => parseRoomDataMessage(encode({ type: "tutor", text: "Answer" }), true));
});

test("hunt M2: malformed or mis-shaped room messages are dropped, not thrown", () => {
  // A non-JSON payload must not throw out of the event handler (one bad
  // message would otherwise interrupt later room events for everyone).
  assert.equal(parseRoomDataMessage(encode("not json {"), false), null);
  assert.equal(parseRoomDataMessage(encode("null"), false), null);
  assert.equal(parseRoomDataMessage(encode([1, 2]), false), null);
  assert.equal(parseRoomDataMessage(encode({ type: "unknown", text: "x" }), false), null);
  // Chat needs a sender (members only) and a non-empty string body.
  assert.deepEqual(parseRoomDataMessage(encode({ type: "chat", text: "Hello" }), false), { type: "chat", text: "Hello" });
  assert.equal(parseRoomDataMessage(encode({ type: "chat", text: "" }), false), null);
  assert.equal(parseRoomDataMessage(encode({ type: "chat", text: { nested: true } }), false), null);
  assert.equal(parseRoomDataMessage(encode({ type: "chat", text: "Server chatter" }), true), null);
  // Raise hand: boolean or absent (absent means raised), never another type.
  assert.deepEqual(parseRoomDataMessage(encode({ type: "raise-hand", raised: false }), false), { type: "raise-hand", raised: false });
  assert.deepEqual(parseRoomDataMessage(encode({ type: "raise-hand" }), false), { type: "raise-hand", raised: true });
  assert.equal(parseRoomDataMessage(encode({ type: "raise-hand", raised: "yes" }), false), null);
  assert.equal(parseRoomDataMessage(encode({ type: "raise-hand", raised: true }), true), null);
});

test("hunt M2: the room dispatches data messages through the source-checked parser", () => {
  const room = roomSource();
  assert.match(room, /const message = parseRoomDataMessage\(payload, !participant\);/);
  assert.equal(room.includes("JSON.parse(new TextDecoder()"), false);
});
