import assert from "node:assert/strict";
import { test } from "node:test";
import { DisconnectReason } from "livekit-client";
import { reconnectDelayMs, studyGroupFormProblem, tutorChatLines } from "../../components/portal/studyGroupClient";
import { liveKitDisconnectReasonName, transitionLiveKitClient } from "../../modules/group-study/liveKitClientRecovery";

// The client helpers the room page and the group dialogs build on (QA 2026-10-19).

test("the SDK's numeric disconnect reason maps to the name the classifier knows (QA N2)", () => {
  const names = DisconnectReason as unknown as Record<number, string>;
  assert.equal(liveKitDisconnectReasonName(DisconnectReason.DUPLICATE_IDENTITY, names), "DUPLICATE_IDENTITY");
  assert.equal(liveKitDisconnectReasonName("ROOM_DELETED", names), "ROOM_DELETED");
  assert.equal(liveKitDisconnectReasonName(undefined, names), undefined);
  // Before the mapping, String(2) reached the classifier and nothing was recognised.
  const duplicate = transitionLiveKitClient({ type: "disconnect", reason: liveKitDisconnectReasonName(DisconnectReason.DUPLICATE_IDENTITY, names), recoveryUsed: true });
  assert.equal(duplicate.type, "terminal");
  assert.equal(transitionLiveKitClient({ type: "disconnect", reason: String(DisconnectReason.DUPLICATE_IDENTITY), recoveryUsed: true }).type, "unavailable");
});

test("reconnect waits back off from one second to a 30 s ceiling and never stop", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map(reconnectDelayMs), [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
});

test("the shared form check names a past start time apart from other problems (BUG-0125)", () => {
  const form = (valid: boolean, underflow = false) => ({
    checkValidity: () => valid,
    elements: [{ validity: { rangeUnderflow: false } }, { validity: { rangeUnderflow: underflow } }]
  });
  assert.equal(studyGroupFormProblem(form(true)), null);
  assert.equal(studyGroupFormProblem(form(false)), "validation");
  assert.equal(studyGroupFormProblem(form(false, true)), "start_in_past");
});

test("the arriving answer replaces the asker's answering line and a republish renders once", () => {
  const pending = { id: "tutor-q1", text: "", pending: true };
  const answer = { id: "tutor-q1", text: "Answer", pending: false };
  const lines = tutorChatLines([{ id: "me-1", text: "@AI Tutor why?", pending: false }, pending], answer);
  assert.deepEqual(lines.map((line) => [line.id, line.text]), [["me-1", "@AI Tutor why?"], ["tutor-q1", "Answer"]]);
  assert.equal(tutorChatLines(lines, answer), lines, "an at-least-once republish is dropped");
  assert.equal(tutorChatLines(lines, pending), lines, "a placeholder never replaces an answer");
});
