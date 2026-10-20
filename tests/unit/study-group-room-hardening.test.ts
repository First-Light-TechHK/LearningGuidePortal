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
import { chatLabel, parseRoomDataMessage, ROOM_CHAT_MAX_LENGTH } from "../../modules/group-study/roomData";

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

test("hunt M5: chat is length-capped and a failed publish is marked, not silently echoed", () => {
  const room = roomSource();
  // The input cap keeps a chat inside LiveKit's data-channel limits; a larger
  // paste cannot be published at all (the SDK throws Message too large).
  assert.equal(ROOM_CHAT_MAX_LENGTH, 2000);
  assert.match(room, /maxLength=\{ROOM_CHAT_MAX_LENGTH\}/);
  // The optimistic echo is reconciled with the publish result: a failed
  // publish marks that line and offers a resend instead of claiming success
  // the other participants never saw.
  assert.match(room, /return publish\(\{ type: "chat", text: line\.text \}\)\.catch\(\(\) => markChatLine\(line\.id, true\)\);/);
  assert.match(room, /void sendChatLine\(line\);/);
  assert.match(room, /\{line\.failed \? <p className=\{styles\.alert\} role="alert">\{copy\.errors\.error\} <button className=\{styles\.textButton\} type="button" onClick=\{\(\) => void sendChatLine\(line\)\}>\{roomCopy\.send\}<\/button><\/p> : null\}/);
});

test("audit F-3: a failed raise-hand broadcast reverts the optimistic toggle", () => {
  const room = roomSource();
  // The raise-hand toggle is an optimistic local broadcast like a chat line
  // (hunt M5): a rejected publish (network drop mid-room, oversized frame)
  // must not leave the local button claiming a state the room never heard.
  // The revert is guarded by the intent that failed, so a newer click that
  // already flipped the state is never undone.
  assert.match(
    room,
    /void publish\(\{ type: "raise-hand", raised \}\)\.catch\(\(\) => setHands\(\(items\) => \(items\.includes\(identity\) === raised \? raisedHands\(items, identity, !raised\) : items\)\)\);/
  );
});

test("audit F-7: a rejected load cannot surface as an unhandled rejection", () => {
  const room = roomSource();
  const loadStart = room.indexOf("async function load()");
  assert.notEqual(loadStart, -1);
  const loadBody = room.slice(loadStart, room.indexOf("async function connect"));
  // The whole body — the session fetch and the group detail — is guarded: a
  // fetch rejection (offline, a gateway's error page) returns quietly and the
  // 3 s poll retries; the panel keeps its current Loading/error state until
  // the retry heals. The not_found handoff must stay inside the guarded body.
  assert.match(loadBody, /try \{/);
  assert.match(loadBody, /\} catch \{/);
  assert.match(loadBody, /setSession\(null\)/);
});

test("audit F-8: a failed leave request cannot skip the room's cleanup", () => {
  const room = roomSource();
  // Breadcrumb navigation (exitTo) is not Leave Session (QA 2026-10-19 seat
  // lease): it sends no request that could hang or fail, only closes the media
  // connection; the server releases the seat when its lease runs out.
  const exitStart = room.indexOf("async function exitTo");
  assert.notEqual(exitStart, -1);
  const exitBody = room.slice(exitStart, room.indexOf("function path()"));
  assert.doesNotMatch(exitBody, /studyGroupRequest/);
  assert.match(exitBody, /await releaseRoom\(\);/);
  assert.match(exitBody, /window\.location\.assign\(href\);/);
  // Leave Session: the request resolves either way (studyGroupRequest never
  // rejects), so the button cannot go "dead". A leave the server did not take
  // keeps the call and offers the leave again; only a taken leave releases the
  // room, shows "You left" and refreshes (QA 2026-10-19 M15).
  const leaveStart = room.indexOf("async function leaveSession");
  assert.notEqual(leaveStart, -1);
  const leaveBody = room.slice(leaveStart, room.indexOf("function rejoin()"));
  assert.match(leaveBody, /const result = await studyGroupRequest\(`\/api\/study-groups\/sessions\/\$\{sessionId\}\/leave`, \{ method: "POST", body: "\{\}" \}\);/);
  assert.match(leaveBody, /if \(!result\.ok && result\.code !== "session_unavailable"\) \{\s*leftRef\.current = false;\s*setLeaveError\(result\.code\);\s*return;\s*\}/);
  assert.match(leaveBody, /await releaseRoom\(\);\s*setLeft\(true\);\s*await load\(\);/);
});

test("hunt M5: the tutor queue enforces the learning-page limit at the service", () => {
  const service = readFileSync(new URL("../../modules/group-study/service.ts", import.meta.url), "utf8");
  assert.match(service, /const TUTOR_REQUEST_MAX_LENGTH = 4000;/);
  assert.match(service, /requireText\(input\.text, "AI Tutor request", TUTOR_REQUEST_MAX_LENGTH\)/);
});

test("hunt L6: chat timestamps follow the app locale, not the browser locale", () => {
  // A local-time wall clock with no zone so the expected hour is stable: both
  // app locales render 24-hour HH:mm, never the browser-locale 12-hour form
  // (an en-US browser used to turn this into 02:15 PM).
  const at = "2026-10-14T14:15:00";
  assert.match(chatLabel("zh-CN", at), /^\d{2}:\d{2}$/);
  assert.match(chatLabel("en-GB", at), /^\d{2}:\d{2}$/);
  assert.equal(/[AaPp]\.?[Mm]/.test(chatLabel("zh-CN", at)), false);
  assert.equal(/[AaPp]\.?[Mm]/.test(chatLabel("en-GB", at)), false);
  // An unparseable stamp echoes back instead of rendering "Invalid Date".
  assert.equal(chatLabel("zh-CN", "not-a-date"), "not-a-date");
  const room = roomSource();
  assert.match(room, /chatLabel\(locale, line\.at\)/);
  assert.equal(room.includes("Intl.DateTimeFormat(undefined"), false);
});
