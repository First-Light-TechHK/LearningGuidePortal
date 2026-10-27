import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createStudyGroupService, type StudyGroupDeps } from "../../modules/group-study/service";
import { createStudyGroupRepository } from "../../modules/group-study/repository";
import { parseLiveKitProjects } from "../../modules/group-study/liveKitProjectRegistry";
import { readJsonObject, studyGroupFailure } from "../../modules/group-study/http";

// UAT QA round 2026-10-27 (report S1-S12): each test pins the corrected
// behaviour of one finding.

let clock = new Date("2026-09-19T02:00:00.000Z").getTime();
let dir: string;
const access = new Set<string>();
const removed: Array<{ room: string; identity: string }> = [];
const notes: Array<{ userId: string; title: string; body: string; sessionId?: string }> = [];
const T = (min: number) => new Date(clock + min * 60_000).toISOString();
const code = (promise: Promise<unknown>) => promise.then(() => "ok", (error: { code?: string }) => error.code);

function make(extra: Partial<StudyGroupDeps> = {}, withGateway = false) {
  const gateway = withGateway ? {
    liveKitProjects: parseLiveKitProjects(JSON.stringify([{ id: "p1", url: "wss://p1.livekit.cloud", state: "active", credentialSecretId: "x/p1" }])),
    liveKitGateway: {
      ensureRoom: async () => undefined,
      issueParticipantToken: async () => ({ token: "tok", expiresAt: T(10), url: "wss://p1" }),
      publishTutorMessage: async () => undefined,
      removeParticipant: async (input: { room: string; identity: string }) => { removed.push({ room: input.room, identity: input.identity }); },
      healthCheck: async ({ project }: { project: { id: string } }) => ({ projectId: project.id, status: "healthy", evidence: "provider_api", providerVerified: true, checkedAt: T(0), latencyMs: 1 })
    }
  } : {};
  return createStudyGroupService({
    repository: createStudyGroupRepository(dir),
    now: () => new Date(clock),
    hasCourseAccess: async (userId, courseId) => access.has(`${userId}:${courseId}`),
    courseSummary: async (courseId) => courseId === "course-1" ? { id: courseId, title: "History", slug: "history" } : null,
    courseLessons: async () => [{ id: "lesson-1", title: "Lesson one" }],
    accessibleCourses: async () => [],
    userProfile: async (userId) => ({ id: userId, displayName: "", email: null, locale: "en-GB" }),
    notify: async (input) => { notes.push(input); },
    listReminders: async () => [],
    sendMail: async () => undefined,
    liveKit: { apiKey: "k", apiSecret: "lk-secret-at-least-32-characters", url: "wss://x" },
    tokenLogKey: () => Buffer.alloc(32, 7),
    tutorKs: async ({ message }) => `Answer: ${message}`,
    publishRoomChat: async () => undefined,
    ...gateway,
    ...extra
  } as StudyGroupDeps);
}

async function liveRoom(service: ReturnType<typeof make>, options: { aiTutorEnabled?: boolean } = {}) {
  const group = await service.createGroup({ actorUserId: "host", title: "G", courseId: "course-1", about: "a" });
  await service.joinGroup({ actorUserId: "m1", groupId: group.id });
  const session = await service.scheduleSession({ actorUserId: "host", groupId: group.id, title: "S", startsAt: T(5), durationSeconds: 1800, maxParticipants: 3, ...options });
  clock += 6 * 60_000;
  await service.enterSession({ actorUserId: "host", sessionId: session.id, requestedAt: `${T(0)}#1` });
  await service.startSession({ actorUserId: "host", sessionId: session.id });
  await service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: `${T(0)}#2` });
  return { group, session };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sg-uat-qa-"));
  clock = new Date("2026-09-19T02:00:00.000Z").getTime();
  access.clear();
  access.add("host:course-1");
  access.add("m1:course-1");
  removed.length = 0;
  notes.length = 0;
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("S1: cancelling a group with a live session disconnects everyone from the room and closes waiting seats", async () => {
  const service = make({}, true);
  const { group, session } = await liveRoom(service);
  await service.issueToken({ actorUserId: "m1", sessionId: session.id });
  const waiting = await service.scheduleSession({ actorUserId: "host", groupId: group.id, title: "Next", startsAt: T(5), durationSeconds: 1800, maxParticipants: 3 });
  await service.enterSession({ actorUserId: "m1", sessionId: waiting.id, requestedAt: `${T(0)}#3` });
  await service.cancelGroup({ actorUserId: "host", groupId: group.id });
  assert.deepEqual(removed.map((item) => item.identity).sort(), ["host", "m1"]);
  const store = await createStudyGroupRepository(dir).read();
  assert.equal(store.presences.filter((item) => item.sessionId === waiting.id && !item.leftAt).length, 0, "the waiting room seat is released");
});

test("S3: a learner whose Course access ended mid-call gets no new token and cannot ask the AI Tutor", async () => {
  const service = make();
  const { session } = await liveRoom(service, { aiTutorEnabled: true });
  access.delete("m1:course-1");
  assert.equal(await code(service.issueToken({ actorUserId: "m1", sessionId: session.id })), "course_access_required");
  assert.equal(await code(service.enqueueTutor({ actorUserId: "m1", sessionId: session.id, text: "q", clientEventId: "e1" })), "course_access_required");
});

test("S4: a question from a member who then left the group is never answered", async () => {
  let ksCalls = 0;
  const service = make({ tutorKs: async () => { ksCalls += 1; return "answer"; } });
  const { group, session } = await liveRoom(service, { aiTutorEnabled: true });
  await service.enqueueTutor({ actorUserId: "m1", sessionId: session.id, text: "q", clientEventId: "e1" });
  await service.leaveGroup({ actorUserId: "m1", groupId: group.id });
  await service.deliverTutorAnswer({ sessionId: session.id });
  assert.equal(ksCalls, 0);
  const store = await createStudyGroupRepository(dir).read();
  assert.deepEqual(store.tutorRequests.map((row) => [row.status, row.terminalReason]), [["dead_letter", "member_left"]]);
});

test("S5: a field that is not text, or a body that is not an object, is a 400", async () => {
  const service = make();
  const error = await service.createGroup({ actorUserId: "host", title: 123 as unknown as string, courseId: "course-1", about: "a" }).catch((caught: unknown) => caught);
  assert.equal(studyGroupFailure(error).status, 400);
  const { session } = await liveRoom(service, { aiTutorEnabled: true });
  const tutorError = await service.enqueueTutor({ actorUserId: "host", sessionId: session.id, text: { a: 1 } as unknown as string, clientEventId: "e" }).catch((caught: unknown) => caught);
  assert.equal(studyGroupFailure(tutorError).status, 400);
  for (const body of ["null", "[]", "5"]) {
    const bodyError = await readJsonObject(new Request("http://x", { method: "POST", body })).catch((caught: unknown) => caught);
    assert.equal(studyGroupFailure(bodyError).status, 400, body);
  }
});

test("S6: no user id stands in for a missing name, and someone outside the group sees no lessons", async () => {
  const service = make();
  const group = await service.createGroup({ actorUserId: "host", title: "G", courseId: "course-1", about: "a" });
  const anonymous = await service.getGroup({ actorUserId: null, groupId: group.id });
  assert.deepEqual(anonymous.lessons, []);
  assert.deepEqual(anonymous.members.map((member) => member.displayName), [""]);
  assert.equal((await service.getGroup({ actorUserId: "host", groupId: group.id })).lessons.length, 1);
});

test("S7: the Related Lesson must be one of the group's Course lessons", async () => {
  const service = make();
  const group = await service.createGroup({ actorUserId: "host", title: "G", courseId: "course-1", about: "a" });
  const base = { actorUserId: "host", groupId: group.id, title: "S", startsAt: T(60), durationSeconds: 1800, maxParticipants: 2 };
  assert.equal(await code(service.scheduleSession({ ...base, relatedLessonId: "x".repeat(200_000) })), "validation");
  assert.equal(await code(service.scheduleSession({ ...base, relatedLessonId: "other-course-lesson" })), "validation");
  assert.equal((await service.scheduleSession({ ...base, relatedLessonId: "lesson-1" })).relatedLessonId, "lesson-1");
});

test("S8: a Start Time needs a time zone and lies within a year", async () => {
  const service = make();
  const group = await service.createGroup({ actorUserId: "host", title: "G", courseId: "course-1", about: "a" });
  const base = { actorUserId: "host", groupId: group.id, title: "S", durationSeconds: 1800, maxParticipants: 2 };
  assert.equal(await code(service.scheduleSession({ ...base, startsAt: "9999-12-31T00:00:00Z" })), "validation");
  assert.equal(await code(service.scheduleSession({ ...base, startsAt: "2026-10-01T10:00" })), "validation");
  assert.equal(await code(service.scheduleSession({ ...base, startsAt: "2026-10-01T10:00:00+08:00" })), "ok");
  const session = await service.scheduleSession({ ...base, title: "S2", startsAt: T(60) });
  assert.equal(await code(service.editSession({ actorUserId: "host", groupId: group.id, sessionId: session.id, startsAt: "2026-10-01T10:00" })), "validation");
});

test("S9: planning again after cancelling sends the reminder again", async () => {
  const service = make();
  const group = await service.createGroup({ actorUserId: "host", title: "G", courseId: "course-1", about: "a" });
  await service.joinGroup({ actorUserId: "m1", groupId: group.id });
  const session = await service.scheduleSession({ actorUserId: "host", groupId: group.id, title: "S", startsAt: T(20), durationSeconds: 1800, maxParticipants: 3 });
  await service.planToAttend({ actorUserId: "m1", sessionId: session.id });
  clock += 11 * 60_000;
  await service.dispatchDueReminders();
  await service.cancelAttendance({ actorUserId: "m1", sessionId: session.id });
  clock += 60_000;
  await service.planToAttend({ actorUserId: "m1", sessionId: session.id });
  await service.dispatchDueReminders();
  assert.equal(notes.filter((note) => note.userId === "m1" && note.title === "Live Session reminder").length, 2);
});

test("S10: a missed session cannot be planned for, and the Host is not a planned attendee", async () => {
  const service = make();
  const group = await service.createGroup({ actorUserId: "host", title: "G", courseId: "course-1", about: "a" });
  await service.joinGroup({ actorUserId: "m1", groupId: group.id });
  const later = await service.scheduleSession({ actorUserId: "host", groupId: group.id, title: "Later", startsAt: T(120), durationSeconds: 1800, maxParticipants: 3 });
  await service.planToAttend({ actorUserId: "host", sessionId: later.id });
  assert.equal((await service.getSession({ actorUserId: "host", sessionId: later.id })).plannedCount, 0);
  const missed = await service.scheduleSession({ actorUserId: "host", groupId: group.id, title: "Missed", startsAt: T(5), durationSeconds: 1800, maxParticipants: 3 });
  clock += 60 * 60_000;
  assert.equal(await code(service.planToAttend({ actorUserId: "m1", sessionId: missed.id })), "forbidden");
});

test("S11: a completed session lists who was in the call, not who only waited", async () => {
  access.add("m2:course-1");
  const service = make();
  const group = await service.createGroup({ actorUserId: "host", title: "G", courseId: "course-1", about: "a" });
  await service.joinGroup({ actorUserId: "m1", groupId: group.id });
  await service.joinGroup({ actorUserId: "m2", groupId: group.id });
  const session = await service.scheduleSession({ actorUserId: "host", groupId: group.id, title: "S", startsAt: T(5), durationSeconds: 1800, maxParticipants: 3 });
  clock += 6 * 60_000;
  await service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: `${T(0)}#0` });
  await service.leaveSession({ actorUserId: "m2", sessionId: session.id });
  await service.enterSession({ actorUserId: "host", sessionId: session.id, requestedAt: `${T(0)}#1` });
  await service.startSession({ actorUserId: "host", sessionId: session.id });
  await service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: `${T(0)}#2` });
  await service.leaveSession({ actorUserId: "m1", sessionId: session.id });
  await service.leaveSession({ actorUserId: "host", sessionId: session.id });
  const view = await service.getSession({ actorUserId: "host", sessionId: session.id });
  assert.equal(view.state, "completed");
  assert.deepEqual(view.attendees.map((person) => person.userId).sort(), ["host", "m1"]);
});

test("S12: cancelling a session tells the members who planned to attend", async () => {
  const service = make();
  const group = await service.createGroup({ actorUserId: "host", title: "G", courseId: "course-1", about: "a" });
  await service.joinGroup({ actorUserId: "m1", groupId: group.id });
  const session = await service.scheduleSession({ actorUserId: "host", groupId: group.id, title: "Poetry", startsAt: T(60), durationSeconds: 1800, maxParticipants: 3 });
  await service.planToAttend({ actorUserId: "m1", sessionId: session.id });
  await service.cancelSession({ actorUserId: "host", sessionId: session.id });
  assert.deepEqual(notes.map((note) => [note.userId, note.title, note.body]), [["m1", "Live Session cancelled", "Poetry has been cancelled."]]);
});
