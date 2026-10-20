// BUG-0109: the portal reminders strip ("view=reminders") must only carry
// currently valid T-10 reminders, and cancelling actions must withdraw the
// pending reminder rows from storage (read-side filter is the backstop).
// The harness wires the real productStore notification storage, the real file
// repository and the real validity rule from the module runtime, so the test
// exercises the server chain exactly as the API route composes it.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { createStudyGroupRepository, type StudyGroupRepository } from "../../modules/group-study/repository";
import { createStudyGroupService, type StudyGroupService } from "../../modules/group-study/service";
import { studyGroupReminderNotificationStillValid } from "../../modules/group-study/runtime";
import {
  listStudyGroupReminders,
  readProductAggregate,
  recordUserNotification,
  withdrawStudyGroupReminders
} from "../../services/productStore";

const cwd = process.cwd();
const env = { ...process.env };
let directory = "";
let repository: StudyGroupRepository;
let service: StudyGroupService;

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function buildService() {
  repository = createStudyGroupRepository(path.join(directory, "sg"));
  return createStudyGroupService({
    repository,
    now: () => new Date(),
    hasCourseAccess: async () => true,
    courseSummary: async (courseId) => ({ id: courseId, title: "German History", slug: "german-history" }),
    accessibleCourses: async () => [],
    userProfile: async (userId) => ({ id: userId, displayName: userId, email: `${userId}@example.test`, locale: "en-GB" }),
    notify: async (input) => {
      await recordUserNotification(input.userId, input.title, input.body, input.sessionId);
    },
    listReminders: async (userId) => {
      const store = await repository.read();
      return listStudyGroupReminders(userId, (item) => studyGroupReminderNotificationStillValid(store, userId, item));
    },
    sendMail: async () => undefined,
    withdrawReminders: async (input) => {
      await withdrawStudyGroupReminders(input);
    },
    liveKit: { apiKey: "", apiSecret: "", url: "" },
    tokenLogKey: () => null
  });
}

async function schedule(serviceUnderTest: StudyGroupService, groupId: string, title: string, startMinutes: number) {
  return serviceUnderTest.scheduleSession({
    actorUserId: "host",
    groupId,
    title,
    startsAt: minutesFromNow(startMinutes),
    durationSeconds: 1800,
    maxParticipants: 4
  });
}

async function linkedReminders(userId: string, sessionId: string) {
  const stored = await readProductAggregate();
  return stored.notifications.filter((item) => item.userId === userId && item.title === "Live Session reminder" && item.sessionId === sessionId);
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-reminders-"));
  process.chdir(directory);
  process.env.APP_ENV = "DEV";
  process.env.STORAGE_BACKEND = "local";
  delete process.env.DATABASE_URL;
  delete process.env.STUDY_GROUP_STORE;
  delete process.env.LIVEKIT_PROJECTS_JSON;
  delete process.env.LIVEKIT_FAKE_GATEWAY;
});

beforeEach(async () => {
  await rm(path.join(directory, "data"), { recursive: true, force: true });
  await rm(path.join(directory, "sg"), { recursive: true, force: true });
  service = buildService();
});

after(async () => {
  process.chdir(cwd);
  process.env = env;
  await rm(directory, { recursive: true, force: true });
});

test("three reminders become one after cancelling and completing two of the sessions", async () => {
  const group = await service.createGroup({ actorUserId: "host", title: "Reminder group", courseId: "course-1", about: "About the reminders." });
  const first = await schedule(service, group.id, "Session one", 5);
  const second = await schedule(service, group.id, "Session two", 6);
  const third = await schedule(service, group.id, "Session three", 7);
  await service.dispatchDueReminders();

  const view = () => service.listReminders("host");
  assert.equal((await view()).length, 3);

  // Cancelling the second Session withdraws its pending reminder row (storage
  // honesty) and the remaining ones still resolve to their Sessions.
  await service.cancelSession({ actorUserId: "host", sessionId: second.id });
  const afterCancel = await view();
  assert.equal(afterCancel.length, 2);
  assert.equal(afterCancel.some((item) => item.body.includes("Session two")), false);
  assert.deepEqual(await linkedReminders("host", second.id), []);
  assert.equal((await linkedReminders("host", first.id)).length, 1);

  // Completing the third Session has no cancelling action, so nothing is
  // withdrawn; the read-side validity filter must drop it as a backstop.
  await service.enterSession({ actorUserId: "host", sessionId: third.id, requestedAt: new Date().toISOString() });
  await service.startSession({ actorUserId: "host", sessionId: third.id });
  await service.leaveSession({ actorUserId: "host", sessionId: third.id });
  assert.equal((await linkedReminders("host", third.id)).length, 1);
  const remaining = await view();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].body, 'Session one in the Study Group "Reminder group" starts in 5 minutes.');
});

test("cancelling the Study Group withdraws its sessions' reminders and hides the cancellation notice", async () => {
  const group = await service.createGroup({ actorUserId: "host", title: "Cancelled group", courseId: "course-1", about: "About the cancel." });
  await service.joinGroup({ actorUserId: "member", groupId: group.id });
  const session = await schedule(service, group.id, "Doomed session", 5);
  await service.planToAttend({ actorUserId: "member", sessionId: session.id });
  await service.dispatchDueReminders();
  assert.equal((await service.listReminders("host")).length, 1);
  assert.equal((await service.listReminders("member")).length, 1);

  await service.cancelGroup({ actorUserId: "host", groupId: group.id });
  assert.deepEqual(await service.listReminders("host"), []);
  assert.deepEqual(await service.listReminders("member"), []);
  assert.deepEqual(await linkedReminders("host", session.id), []);
  assert.deepEqual(await linkedReminders("member", session.id), []);
  // The cancellation notice is recorded for members but never surfaces as a reminder.
  const stored = await readProductAggregate();
  assert.equal(stored.notifications.some((item) => item.userId === "member" && item.title === "Study Group cancelled"), true);
});

test("leaving the group withdraws only the leaver's reminders", async () => {
  const group = await service.createGroup({ actorUserId: "host", title: "Leaving group", courseId: "course-1", about: "About the leave." });
  await service.joinGroup({ actorUserId: "member", groupId: group.id });
  const session = await schedule(service, group.id, "Leave session", 5);
  await service.planToAttend({ actorUserId: "member", sessionId: session.id });
  await service.dispatchDueReminders();
  assert.equal((await service.listReminders("member")).length, 1);

  await service.leaveGroup({ actorUserId: "member", groupId: group.id });
  assert.deepEqual(await service.listReminders("member"), []);
  assert.deepEqual(await linkedReminders("member", session.id), []);
  assert.equal((await linkedReminders("host", session.id)).length, 1);
  assert.equal((await service.listReminders("host")).length, 1);
});

test("cancelling attendance withdraws that member's reminder for the session", async () => {
  const group = await service.createGroup({ actorUserId: "host", title: "Attendance group", courseId: "course-1", about: "About the attendance." });
  await service.joinGroup({ actorUserId: "member", groupId: group.id });
  const session = await schedule(service, group.id, "Attendance session", 5);
  await service.planToAttend({ actorUserId: "member", sessionId: session.id });
  await service.dispatchDueReminders();
  assert.equal((await service.listReminders("member")).length, 1);

  await service.cancelAttendance({ actorUserId: "member", sessionId: session.id });
  assert.deepEqual(await service.listReminders("member"), []);
  assert.deepEqual(await linkedReminders("member", session.id), []);
  assert.equal((await linkedReminders("host", session.id)).length, 1);
});

test("the view hides legacy, foreign, rescheduled and started reminders", async () => {
  await recordUserNotification("host", "Live Session reminder", "Legacy starts in 10 minutes.");
  await recordUserNotification("host", "Order receipt", "Not a reminder.");

  const group = await service.createGroup({ actorUserId: "host", title: "Validity group", courseId: "course-1", about: "About the validity." });
  const session = await schedule(service, group.id, "Rescheduled", 5);
  await service.dispatchDueReminders();
  const view = () => service.listReminders("host");
  assert.equal((await view()).some((item) => item.body === 'Rescheduled in the Study Group "Validity group" starts in 5 minutes.'), true);
  assert.equal((await view()).some((item) => item.body === "Legacy starts in 10 minutes."), false);
  assert.equal((await view()).some((item) => item.body === "Not a reminder."), false);

  // Moving the Start Time withdraws the reminder for the old time (QA
  // 2026-10-19 N9); the new time gets its own when its window opens.
  await service.editSession({ actorUserId: "host", groupId: group.id, sessionId: session.id, startsAt: minutesFromNow(180) });
  assert.deepEqual(await view(), []);
  assert.deepEqual(await linkedReminders("host", session.id), []);

  // Once the Session starts, the reminder stops being a pending prompt.
  const open = await schedule(service, group.id, "Starting now", 5);
  await service.dispatchDueReminders();
  assert.equal((await view()).some((item) => item.body === 'Starting now in the Study Group "Validity group" starts in 5 minutes.'), true);
  await service.enterSession({ actorUserId: "host", sessionId: open.id, requestedAt: new Date().toISOString() });
  await service.startSession({ actorUserId: "host", sessionId: open.id });
  assert.equal((await view()).some((item) => item.body === 'Starting now in the Study Group "Validity group" starts in 5 minutes.'), false);
});

test("a pre-linkage reminder keeps showing while its session is still pending", async () => {
  const group = await service.createGroup({ actorUserId: "host", title: "Legacy group", courseId: "course-1", about: "About the legacy." });
  const session = await schedule(service, group.id, "Legacy session", 5);
  // Reproduce the pre-BUG-0109 shape that existing environments carry: the
  // dispatch's reminder row exists, but the notification predates the
  // sessionId linkage, so the row is resolved through the session title in
  // the body (both recorded copy variants).
  await repository.update((store) => {
    store.reminders.push({ id: "legacy-reminder-row", sessionId: session.id, userId: "host", sentAt: new Date().toISOString() });
  });
  await recordUserNotification("host", "Live Session reminder", "Legacy session starts in 10 minutes.");
  await recordUserNotification("host", "Live Session reminder", "Legacy session 将在 10 分钟后开始。");
  const shown = await service.listReminders("host");
  assert.equal(shown.some((item) => item.body === "Legacy session starts in 10 minutes."), true);
  assert.equal(shown.some((item) => item.body === "Legacy session 将在 10 分钟后开始。"), true);
  // Cancelling the Session hides the resolved reminder through the read-side
  // filter: a pre-linkage row has no sessionId the withdrawal could match.
  await service.cancelSession({ actorUserId: "host", sessionId: session.id });
  assert.deepEqual(await service.listReminders("host"), []);
});

