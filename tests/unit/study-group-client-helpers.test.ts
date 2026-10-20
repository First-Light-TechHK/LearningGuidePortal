import assert from "node:assert/strict";
import { test } from "node:test";
import { DisconnectReason } from "livekit-client";
import { readFileSync } from "node:fs";
import { reconnectDelayMs, roomGateAction, roomSignInHref, screenShareSupported, seatReentryAction, studyGroupFormProblem, tutorAskAgain, tutorChatLines, TUTOR_REFUSAL_CODES, tutorQueueBody, tutorRefusalReason } from "../../components/portal/studyGroupClient";
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

const en = JSON.parse(readFileSync(new URL("../../messages/en-GB.json", import.meta.url), "utf8")) as { studyGroupsPage: { room: Record<string, string>; errors: Record<string, string> } };
const zh = JSON.parse(readFileSync(new URL("../../messages/zh-CN.json", import.meta.url), "utf8")) as typeof en;

test("an answer that came back unavailable lets the question be asked again (QA r3-B2)", () => {
  const lines = [{ id: "local-0" }, { id: "tutor-a", mode: "unavailable" }, { id: "tutor-b", mode: "course" }, { id: "tutor-c" }];
  assert.equal(tutorAskAgain(lines, "tutor-a"), true);
  assert.equal(tutorAskAgain(lines, "tutor-b"), false);
  // Still answering, not asked yet, or an answer the page never saw: nothing to ask again.
  assert.equal(tutorAskAgain(lines, "tutor-c"), false);
  assert.equal(tutorAskAgain(lines, undefined), false);
  assert.equal(tutorAskAgain(lines, "tutor-missing"), false);
  // A late real answer replaces the timed-out line, and the offer goes away.
  const answered = tutorChatLines([{ id: "tutor-a", pending: true, mode: "unavailable" as string }], { id: "tutor-a", mode: "course" });
  assert.equal(tutorAskAgain(answered, "tutor-a"), false);
});

test("every ask carries its client event id, so a retry is answered once (QA M21)", () => {
  assert.deepEqual(tutorQueueBody("What is ataraxia?", "event-1"), { message: "What is ataraxia?", clientEventId: "event-1" });
});

test("a refused question names why it never reached the AI Tutor, in both languages (QA X-5)", () => {
  for (const copy of [en, zh]) {
    const words = { errors: copy.studyGroupsPage.errors, notLive: copy.studyGroupsPage.room.tutorNotLive };
    assert.match(copy.studyGroupsPage.room.tutorNotSent, /\{reason\}/);
    for (const code of TUTOR_REFUSAL_CODES) {
      const reason = tutorRefusalReason(code, words);
      assert.ok(reason, code);
      assert.notEqual(reason, copy.studyGroupsPage.errors.error, code);
    }
    assert.equal(tutorRefusalReason("session_not_open", words), copy.studyGroupsPage.room.tutorNotLive);
    assert.equal(tutorRefusalReason("seat_lapsed", words), copy.studyGroupsPage.errors.seat_lapsed);
    assert.equal(tutorRefusalReason("something_new", words), copy.studyGroupsPage.errors.error);
  }
});

test("LiveKit being briefly unavailable reads apart from not configured (QA M12)", () => {
  for (const copy of [en, zh]) {
    const errors = copy.studyGroupsPage.errors;
    assert.ok(errors.livekit_temporarily_unavailable);
    assert.notEqual(errors.livekit_temporarily_unavailable, errors.unavailable);
  }
  assert.match(en.studyGroupsPage.errors.livekit_temporarily_unavailable, /temporarily unavailable/);
});

test("a full session under a still-connected call keeps the call and retries (QA X-4)", () => {
  assert.equal(seatReentryAction("session_full", true), "keep");
  assert.equal(seatReentryAction("session_full", false), "stop");
  for (const code of ["forbidden", "not_found", "session_unavailable", "course_access_required", "unauthenticated"]) {
    assert.equal(seatReentryAction(code, true), "stop", code);
  }
  // A passing failure (network, a 500) is retried by the next heartbeat.
  assert.equal(seatReentryAction("network", false), "keep");
  assert.equal(seatReentryAction("error", true), "keep");
});

test("a room page that cannot show the session points the way on (QA M20)", () => {
  assert.equal(roomGateAction("unauthenticated"), "sign-in");
  assert.equal(roomGateAction("forbidden"), "groups");
  assert.equal(roomGateAction("not_found"), "groups");
  assert.equal(roomGateAction("course_access_required"), "groups");
  assert.equal(roomGateAction("network"), "retry");
  assert.equal(roomGateAction("error"), "retry");
  assert.equal(roomSignInHref("en-GB", "s-1"), "/en-GB/portal/sign-in?returnTo=%2Fen-GB%2Fportal%2Fstudy-groups%2Fsessions%2Fs-1");
});

test("Share shows only where the browser can capture a screen (QA M18)", () => {
  assert.equal(screenShareSupported({ getDisplayMedia: () => undefined }), true);
  assert.equal(screenShareSupported({}), false);
  assert.equal(screenShareSupported(undefined), false);
});
