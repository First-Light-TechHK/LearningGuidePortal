import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tutorChatLines, tutorProgressLines } from "../../components/portal/studyGroupClient";
import { parseRoomDataMessage } from "../../modules/group-study/roomData";

// Design §3.2 client companion / §4.5: the room-message outbox publishes
// at-least-once, so a crash between publish and settle can republish an
// answer with the same tutor message id; the room must render it once.

type ChatLine = { id: string; from: string; text: string; at: string; tutor: boolean };

function tutorLine(id: string, text: string, at = "2026-09-19T02:00:00.000Z"): ChatLine {
  return { id, from: "AI Tutor", text, at, tutor: true };
}

test("a republished tutor answer renders once per payload message id", () => {
  const first = tutorLine("tutor-m-1", "The republic ended in 1933.");
  const afterFirst = tutorChatLines<ChatLine>([], first);
  assert.deepEqual(afterFirst, [first]);
  const repeated = tutorChatLines(afterFirst, tutorLine("tutor-m-1", "The republic ended in 1933.", "2026-09-19T02:00:05.000Z"));
  assert.equal(repeated, afterFirst, "a repeat returns the same array reference (no double render)");
  assert.equal(repeated.length, 1);
  const afterSecond = tutorChatLines(repeated, tutorLine("tutor-m-2", "Second answer."));
  assert.deepEqual(afterSecond.map((line) => line.id), ["tutor-m-1", "tutor-m-2"]);
});

test("the room keys tutor chat lines by the payload message id", () => {
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /id: message\.id \? `tutor-\$\{message\.id\}` : `tutor-\$\{items\.length\}`/);
  assert.match(room, /setChat\(\(items\) => tutorChatLines\(items, \{/);
});

test("only server progress updates a pending answer, ordered by sequence; final wins", () => {
  const packet = new TextEncoder().encode(JSON.stringify({ type: "tutor-progress", id: "m-1", text: "First", sequence: 1 }));
  assert.equal(parseRoomDataMessage(packet, false), null);
  assert.deepEqual(parseRoomDataMessage(packet, true), { type: "tutor-progress", id: "m-1", text: "First", sequence: 1 });
  const pending = { ...tutorLine("tutor-m-1", ""), pending: true, progressSeq: 0 };
  const first = tutorProgressLines([pending], { ...pending, text: "First", progressSeq: 1 });
  const later = tutorProgressLines(first, { ...pending, text: "First answer", progressSeq: 2 });
  assert.equal(tutorProgressLines(later, { ...pending, text: "stale", progressSeq: 1 }), later);
  const final = tutorChatLines(later, { ...tutorLine("tutor-m-1", "Final answer"), pending: false, progressSeq: 2 });
  assert.equal(final[0].text, "Final answer");
  assert.equal(tutorProgressLines(final, { ...pending, text: "late", progressSeq: 3 }), final);
});
