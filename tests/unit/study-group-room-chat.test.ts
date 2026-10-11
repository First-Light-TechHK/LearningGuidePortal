import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tutorChatLines } from "../../components/portal/studyGroupClient";

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
