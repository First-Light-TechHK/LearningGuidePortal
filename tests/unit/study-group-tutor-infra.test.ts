import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { createStudyGroupRepository } from "../../modules/group-study/repository";
import { createStudyGroupService, type StudyGroupDeps } from "../../modules/group-study/service";
import { createTutorHealth } from "../../modules/group-study/tutorHealth";
import { tutorOfflineReason, tutorPendingState, tutorStillWaiting } from "../../components/portal/studyGroupClient";
import { parseRoomDataMessage } from "../../modules/group-study/roomData";

// Tutor infra 2026-10-20, service level: the room's Tutor remembers the
// conversation and its understanding checks, answers askers by turns, lets an
// asker take back a waiting question, says why an answer is unavailable, tells
// the room whether it is offered at all, and leaves one redacted line per
// question.

const NOW = "2026-09-19T02:00:00.000Z";
const directories: string[] = [];
afterEach(async () => {
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true });
});

type Published = { text: string; mode: string; kind?: string; reason?: string; replyTo?: { name: string; question: string } };
type Call = { text: string; model?: string; roomContext?: string };

async function room(extra: Partial<StudyGroupDeps> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-tutor-infra-"));
  directories.push(directory);
  const published: Published[] = [];
  const calls: Call[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const access = new Set(["host:course-1", "m1:course-1", "m2:course-1"]);
  const deps: StudyGroupDeps = {
    repository: createStudyGroupRepository(directory),
    now: () => new Date(NOW),
    hasCourseAccess: async (userId, courseId) => access.has(`${userId}:${courseId}`),
    courseSummary: async (courseId) => ({ id: courseId, title: "Epicureanism", slug: "epicureanism" }),
    accessibleCourses: async () => [],
    userProfile: async (userId) => ({ id: userId, displayName: userId, email: `${userId}@example.test`, locale: "en-GB" }),
    notify: async () => undefined,
    listReminders: async () => [],
    sendMail: async () => undefined,
    liveKit: { apiKey: "lk-key", apiSecret: "lk-secret-at-least-32-characters", url: "wss://livekit.example.test" },
    tokenLogKey: () => Buffer.alloc(32, 7),
    courseKnowledge: async () => "Epicurus: death is nothing to us.",
    publishRoomChat: async (input) => { published.push({ text: input.text, mode: input.mode, ...(input.kind ? { kind: input.kind } : {}), ...(input.reason ? { reason: input.reason } : {}), ...(input.replyTo ? { replyTo: input.replyTo } : {}) }); },
    tutorKeys: () => [{ id: "k", secret: "fake-tutor-key-0123456789" }],
    tutorCall: async (input) => {
      calls.push({ text: input.text, model: input.model, roomContext: input.roomContext });
      return { outcome: "ok", latencyMs: 1, body: `COURSE\nAnswer to: ${input.text}` };
    },
    tutorRetryWait: async () => undefined,
    operationalLog: (event) => { logs.push(event); },
    ...extra
  };
  const service = createStudyGroupService(deps);
  const group = await service.createGroup({ actorUserId: "host", title: "Tutor infra", courseId: "course-1", about: "About the group." });
  for (const member of ["m1", "m2"]) await service.joinGroup({ actorUserId: member, groupId: group.id });
  const session = await service.scheduleSession({ actorUserId: "host", groupId: group.id, title: "Tutor infra", startsAt: "2026-09-19T02:05:00.000Z", durationSeconds: 1800, maxParticipants: 4, aiTutorEnabled: true });
  for (const actor of ["host", "m1", "m2"]) await service.enterSession({ actorUserId: actor, sessionId: session.id, requestedAt: NOW });
  await service.startSession({ actorUserId: "host", sessionId: session.id });
  let event = 0;
  const ask = (actor: string, text: string) => service.enqueueTutor({ actorUserId: actor, sessionId: session.id, text, clientEventId: `evt-${event++}` });
  return { service, session, published, calls, logs, ask, deliver: () => service.deliverTutorAnswer({ sessionId: session.id }), view: (actor = "host") => service.getSession({ actorUserId: actor, sessionId: session.id }) };
}

test("the Tutor remembers the room: a follow-up call carries the earlier question and answer", async () => {
  const r = await room();
  await r.ask("host", "Why not fear death?");
  await r.deliver();
  await r.ask("m1", "Explain the second point");
  await r.deliver();
  assert.equal(r.calls[0].roomContext, "", "the first question has no history");
  assert.match(r.calls[1].roomContext ?? "", /Participant asked: Why not fear death\?\nYou answered: Answer to: Why not fear death\?/);
});

test("an understanding check is published as a quiz and stays open in the room context", async () => {
  let reply = "COURSE QUIZ\nWhy should we not fear death?";
  const r = await room({
    tutorCall: async (input) => {
      const body = reply;
      reply = "COURSE\nRight: death is the end of sensation.";
      return { outcome: "ok", latencyMs: 1, body, ...(input.roomContext ? {} : {}) };
    }
  });
  await r.ask("host", "Quiz us on Epicurus");
  await r.deliver();
  assert.deepEqual(r.published[0], { text: "Why should we not fear death?", mode: "course", kind: "quiz", replyTo: { name: "host", question: "Quiz us on Epicurus" } });
  let context = "";
  const s = await room({
    tutorCall: async (input) => {
      context = input.roomContext ?? "";
      return { outcome: "ok", latencyMs: 1, body: input.text.includes("Quiz") ? "COURSE QUIZ\nWhy should we not fear death?" : "COURSE\nRight." };
    }
  });
  await s.ask("host", "Quiz us on Epicurus");
  await s.deliver();
  await s.ask("m1", "Because death is the end of sensation");
  await s.deliver();
  assert.match(context, /Open understanding check \(asked 0 min ago\): Why should we not fear death\?/);
  assert.equal(s.published[1].kind, undefined, "the graded answer is not a new quiz");
});

test("askers take turns: everyone's first question before anyone's second", async () => {
  const r = await room();
  await r.ask("host", "host first");
  await r.ask("host", "host second");
  await r.ask("m1", "m1 first");
  await r.deliver();
  assert.deepEqual(r.calls.map((call) => call.text), ["host first", "m1 first", "host second"]);
});

test("the asker sees how many questions come first, and can withdraw one the Tutor has not started", async () => {
  const r = await room();
  const first = await r.ask("host", "host first");
  const second = await r.ask("m1", "m1 first");
  const third = await r.ask("m1", "m1 second");
  assert.deepEqual([first.position, second.position, third.position], [0, 1, 2]);
  const view = await r.view("m1");
  assert.deepEqual(view.viewerTutorQuestions, [{ id: second.id, position: 1, answering: false }, { id: third.id, position: 2, answering: false }]);
  assert.deepEqual(await r.service.withdrawTutor({ actorUserId: "m1", sessionId: r.session.id, requestId: third.id }), { id: third.id, withdrawn: true });
  await assert.rejects(() => r.service.withdrawTutor({ actorUserId: "host", sessionId: r.session.id, requestId: second.id }), (error: unknown) => (error as { code: string }).code === "not_found", "only the asker can withdraw");
  await r.deliver();
  assert.deepEqual(r.calls.map((call) => call.text), ["host first", "m1 first"], "the withdrawn question is never answered");
  assert.deepEqual(await r.service.withdrawTutor({ actorUserId: "m1", sessionId: r.session.id, requestId: second.id }), { id: second.id, withdrawn: false }, "an answered question cannot be taken back");
  assert.deepEqual((await r.view("m1")).viewerTutorQuestions, []);
});

test("a question being answered cannot be withdrawn", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const begun = new Promise<void>((resolve) => { started = resolve; });
  const r = await room({
    tutorCall: async () => {
      started();
      await gate;
      return { outcome: "ok", latencyMs: 1, body: "COURSE\nDone." };
    }
  });
  const asked = await r.ask("host", "slow one");
  const delivery = r.deliver();
  await begun;
  assert.deepEqual((await r.view("host")).viewerTutorQuestions, [{ id: asked.id, position: 0, answering: true }]);
  await assert.rejects(() => r.service.withdrawTutor({ actorUserId: "host", sessionId: r.session.id, requestId: asked.id }), (error: unknown) => (error as { code: string }).code === "tutor_answering");
  release();
  await delivery;
  assert.equal(r.published[0].text, "Done.");
});

test("an unavailable answer says why, and one redacted line per question is logged", async () => {
  const r = await room({
    tutorModels: () => ["retired/model"],
    tutorCall: async () => ({ outcome: "model_gone", latencyMs: 1 })
  });
  await r.ask("host", "Anyone there? fake-tutor-key-0123456789");
  await r.deliver();
  // The room gets a coarse class; the log keeps the precise one.
  assert.deepEqual([r.published[0].mode, r.published[0].reason], ["unavailable", "provider"]);
  const line = r.logs.find((event) => event.type === "study_group.tutor_answer");
  assert.deepEqual(line && { outcome: line.outcome, reason: line.reason }, { outcome: "failed", reason: "model_gone" });
  const text = JSON.stringify(r.logs);
  for (const secret of ["Anyone there", "fake-tutor-key", "host", r.session.id]) assert.equal(text.includes(secret), false, `the log carries no ${secret}`);
});

test("model fallback through the service: a retired primary hands the question to the next model", async () => {
  const r = await room({
    tutorModels: () => ["retired/model", "working/model"],
    tutorCall: async (input) => input.model === "retired/model" ? { outcome: "model_gone", latencyMs: 1 } : { outcome: "ok", latencyMs: 1, body: "COURSE\nFrom the backup.", model: "working/model" }
  });
  await r.ask("host", "Who answers?");
  await r.deliver();
  assert.equal(r.published[0].text, "From the backup.");
  const snapshot = await r.service.tutorHealthSnapshot();
  assert.deepEqual([snapshot.goneModels, snapshot.answeredByModel], [["retired/model"], { "working/model": 1 }]);
});

test("the room is told whether the Tutor is offered: no key, provider down, over budget", async () => {
  const none = await room({ tutorKeys: () => [] });
  assert.deepEqual((await none.view()).tutor, { available: false, reason: "no_key" });
  assert.equal(tutorOfflineReason(await none.view()), "no_key");

  const health = createTutorHealth();
  const down = await room({ tutorHealth: health, tutorCall: async () => ({ outcome: "upstream_error", latencyMs: 1 }) });
  assert.deepEqual((await down.view()).tutor, { available: true });
  for (let index = 0; index < 3; index += 1) {
    await down.ask("host", `try ${index}`);
    await down.deliver();
  }
  assert.deepEqual((await down.view()).tutor, { available: false, reason: "provider_down" });

  const spent = createTutorHealth();
  spent.addSpend(2);
  const budget = await room({ tutorHealth: spent, tutorDailyBudgetUsd: 1 });
  assert.deepEqual((await budget.view()).tutor, { available: false, reason: "budget" });
  // The server refuses the question outright: the room already says why.
  await assert.rejects(() => budget.ask("host", "over budget?"), (error: unknown) => (error as { code: string }).code === "tutor_unavailable");
  await budget.deliver();
  assert.equal(budget.calls.length, 0, "no paid call over the budget");
  await assert.rejects(() => down.ask("m1", "still down?"), (error: unknown) => (error as { code: string }).code === "tutor_unavailable", "a paused Tutor takes no question");
});

test("the room's helpers read the server's word: offline reason and the waiting line", () => {
  assert.equal(tutorOfflineReason({ aiTutorEnabled: true, tutor: { available: true } }), null);
  assert.equal(tutorOfflineReason({ aiTutorEnabled: true }), null, "an older server without the field offers the Tutor");
  assert.equal(tutorOfflineReason({ aiTutorEnabled: false, tutor: { available: false, reason: "budget" } }), null);
  const session = { viewerTutorQuestions: [{ id: "q1", position: 0, answering: true }, { id: "q2", position: 2, answering: false }, { id: "q3", position: 0, answering: false }] };
  assert.deepEqual(tutorPendingState(session, "tutor-q1"), { state: "answering", ahead: 0, withdrawable: false });
  assert.deepEqual(tutorPendingState(session, "tutor-q2"), { state: "queued", ahead: 2, withdrawable: true });
  assert.deepEqual(tutorPendingState(session, "tutor-q3"), { state: "queued", ahead: 0, withdrawable: true }, "next up is not yet answering");
  assert.equal(tutorStillWaiting(session, "tutor-q2"), true);
  assert.equal(tutorStillWaiting(session, "tutor-q9"), false);
  assert.deepEqual(tutorPendingState(null, "tutor-q9"), { state: "answering", ahead: 0, withdrawable: false });
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  assert.deepEqual(parseRoomDataMessage(encode({ type: "tutor", id: "a", text: "Why?", mode: "course", kind: "quiz" }), true), { type: "tutor", id: "a", text: "Why?", mode: "course", kind: "quiz" });
  assert.deepEqual(parseRoomDataMessage(encode({ type: "tutor", id: "b", text: "", mode: "unavailable", reason: "model_gone", kind: "quiz" }), true), { type: "tutor", id: "b", text: "", mode: "unavailable", reason: "model_gone" });
  assert.equal((parseRoomDataMessage(encode({ type: "tutor", text: "x", mode: "course", reason: "<script>" }), true) as { reason?: string }).reason, undefined);
});
