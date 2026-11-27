// NTF-REV-02/05: the five legacy catalogue templates (HelpDesk reply, the
// four Live Session events) must go through one template-aware send path:
// enabled switches, operator copy, rendering, event-key dedupe and the email
// channel (with the verified-address check) all apply. These tests wire the
// real product store, the real Study Group service and the real runtime
// notifier, so the trigger-to-storage chain is exercised end to end.
//
// Red-first: written before services/notifications/service.ts exported
// emitCatalogueNotification and modules/group-study/runtime.ts exported
// studyGroupNotify.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { createStudyGroupRepository } from "../../modules/group-study/repository";
import { createStudyGroupService, type StudyGroupService } from "../../modules/group-study/service";

const originalCwd = process.cwd();
const originalEnv = { ...process.env };
let isolatedCwd = "";
let store: typeof import("../../services/productStore");
let notifications: typeof import("../../services/notifications/service");
let runtime: typeof import("../../modules/group-study/runtime");
let originalCreateTransport: typeof nodemailer.createTransport;

type Mail = { to: string; subject: string; text: string };
let mails: Mail[] = [];

const APP_URL = "https://learningguide.test";

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-catalogue-routing-"));
  process.chdir(isolatedCwd);
  process.env.APP_ENV = "DEV";
  process.env.STORAGE_BACKEND = "local";
  delete process.env.DATABASE_URL;
  delete process.env.STUDY_GROUP_STORE;
  delete process.env.LIVEKIT_PROJECTS_JSON;
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_USER = "sender@example.test";
  process.env.SMTP_PASS = "test-only";
  process.env.SMTP_FROM = "Learning Guide <no-reply@example.test>";
  originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = (() => ({
    sendMail: async (mail: Mail) => {
      mails.push(mail);
      return { messageId: `<${mails.length}@example.test>`, accepted: [mail.to], rejected: [] };
    },
  })) as unknown as typeof nodemailer.createTransport;

  store = await import("../../services/productStore");
  notifications = await import("../../services/notifications/service");
  runtime = await import("../../modules/group-study/runtime");
  await store.ensureProductData();
  await store.persistDataMigrations();
});

after(async () => {
  nodemailer.createTransport = originalCreateTransport;
  process.chdir(originalCwd);
  process.env = originalEnv;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

type TestUser = { id: string; email: string; nickname: string; locale: "en-GB" | "zh-CN" };

let userSeq = 0;
async function makeUser(options: { verified?: boolean; locale?: "en-GB" | "zh-CN" } = {}): Promise<TestUser> {
  userSeq += 1;
  const email = `catalogue-${userSeq}@example.test`;
  const user = await store.registerUser({ email, password: "password1", nickname: `Student ${userSeq}` });
  if (options.verified !== false) await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  if (options.locale && options.locale !== "en-GB") await store.setUserLocale(user.id, options.locale);
  const stored = await store.getUserById(user.id);
  assert.ok(stored);
  return { id: stored.id, email: stored.email ?? email, nickname: stored.nickname, locale: stored.locale };
}

async function setTemplate(id: string, patch: { enabled?: boolean; en?: Record<string, string>; zh?: Record<string, string> }) {
  const result = await notifications.updateTemplate({
    id,
    enabled: patch.enabled,
    en: patch.en as never,
    zh: patch.zh as never,
    operator: "test-operator",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
}

async function rowsFor(userId: string, templateId: string) {
  const data = await store.ensureProductData();
  return data.notifications.filter((item) => item.userId === userId && item.templateId === templateId && !item.isTest);
}

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

const profiles = new Map<string, { id: string; displayName: string; email: string | null; locale: "en-GB" | "zh-CN" }>();

function serviceFor(): StudyGroupService {
  return createStudyGroupService({
    repository: createStudyGroupRepository(path.join(isolatedCwd, "sg-" + randomUUID())),
    now: () => new Date(),
    hasCourseAccess: async () => true,
    courseSummary: async (courseId) => ({ id: courseId, title: "Course", slug: "course" }),
    accessibleCourses: async () => [],
    userProfile: async (userId) => profiles.get(userId) ?? null,
    notify: runtime.studyGroupNotify,
    accountActive: async () => true,
    listReminders: async () => [],
    withdrawReminders: async () => undefined,
    sendMail: async () => undefined,
    sessionLink: (sessionId, locale) => `${APP_URL}/${locale}/portal/study-groups/sessions/${sessionId}`,
    liveKit: { apiKey: "", apiSecret: "", url: "" },
    tokenLogKey: () => null,
  });
}

function remember(user: TestUser) {
  profiles.set(user.id, { id: user.id, displayName: user.nickname, email: user.email, locale: user.locale });
}

async function groupWithMember(owner: TestUser, member: TestUser, title: string) {
  remember(owner);
  remember(member);
  const service = serviceFor();
  const group = await service.createGroup({ actorUserId: owner.id, title, courseId: "course-1", about: "Routing test." });
  await service.joinGroup({ actorUserId: member.id, groupId: group.id });
  return { service, group };
}

test("a catalogue event uses the operator's edited copy when the template is on", async () => {
  const user = await makeUser();
  await setTemplate("LIVE_SESSION_BOOKED", {
    enabled: true,
    en: {
      title: "Reserved: {{session_title}}",
      message: "Your seat for {{session_title}} in {{group_name}} is saved.",
      buttonText: "View session",
    },
  });
  const owner = await makeUser();
  const { service, group } = await groupWithMember(owner, user, "Operator copy group");
  const session = await service.scheduleSession({
    actorUserId: owner.id, groupId: group.id, title: "Copy session",
    startsAt: minutesFromNow(120), durationSeconds: 1800, maxParticipants: 4,
  });

  await service.planToAttend({ actorUserId: user.id, sessionId: session.id });

  const rows = await rowsFor(user.id, "LIVE_SESSION_BOOKED");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Reserved: Copy session");
  assert.match(rows[0].body, /Your seat for Copy session in Operator copy group is saved\./);
  assert.equal(rows[0].sessionId, session.id);
  assert.ok(rows[0].eventKey?.includes(session.id) && rows[0].eventKey.includes(user.id));
});

test("LIVE_SESSION_BOOKED fires once per booking and the event key dedupes a replay", async () => {
  const user = await makeUser();
  await setTemplate("LIVE_SESSION_BOOKED", { enabled: true });
  const owner = await makeUser();
  const { service, group } = await groupWithMember(owner, user, "Booking group");
  const session = await service.scheduleSession({
    actorUserId: owner.id, groupId: group.id, title: "Booking session",
    startsAt: minutesFromNow(120), durationSeconds: 1800, maxParticipants: 4,
  });

  await service.planToAttend({ actorUserId: user.id, sessionId: session.id });
  // A second plan while the first is live is a no-op in the module.
  await service.planToAttend({ actorUserId: user.id, sessionId: session.id });

  const rows = await rowsFor(user.id, "LIVE_SESSION_BOOKED");
  assert.equal(rows.length, 1);
  const replay = await notifications.emitCatalogueNotification({
    templateId: "LIVE_SESSION_BOOKED",
    userId: user.id,
    eventKey: rows[0].eventKey!,
    params: {
      session_title: "Booking session", group_name: "Booking group",
      session_date: session.startsAt, session_time: session.startsAt,
      session_link: `${APP_URL}/en-GB/portal/study-groups/sessions/${session.id}`,
    },
    channels: ["in_app"],
    sessionId: session.id,
  });
  assert.equal(replay.created, false);
  assert.equal((replay as { reason: string }).reason, "duplicate");
  assert.equal((await rowsFor(user.id, "LIVE_SESSION_BOOKED")).length, 1);
});

test("a switched-off template writes no in-app row and sends no email", async () => {
  const user = await makeUser();
  await setTemplate("LIVE_SESSION_RESCHEDULED", { enabled: false });
  const before = (await store.ensureProductData()).notifications.filter((item) => item.userId === user.id).length;
  const beforeMails = mails.length;

  const result = await notifications.emitCatalogueNotification({
    templateId: "LIVE_SESSION_RESCHEDULED",
    userId: user.id,
    eventKey: `session:off:${randomUUID()}`,
    params: {
      session_title: "Off session", group_name: "Off group",
      session_date: minutesFromNow(60), session_time: minutesFromNow(60),
      session_link: "/portal/study-groups/sessions/off",
    },
    channels: ["in_app", "email"],
  });

  assert.equal(result.created, false);
  assert.equal((result as { reason: string }).reason, "disabled");
  const after = (await store.ensureProductData()).notifications.filter((item) => item.userId === user.id).length;
  assert.equal(after, before, "no in-app row while off");
  assert.equal(mails.length, beforeMails, "no email while off");
  const data = await store.ensureProductData();
  const emailLogs = (data.notificationLog || []).filter((item) => item.userId === user.id && item.channel === "email" && item.status !== "failed");
  assert.equal(emailLogs.length, 0);
});

test("the T-10 reminder follows its switch, renders operator copy, and only emails verified addresses", async () => {
  const verified = await makeUser({ verified: true });
  const unverified = await makeUser({ verified: false });
  await setTemplate("LIVE_SESSION_REMINDER", {
    enabled: true,
    en: {
      title: "Soon: {{session_title}}",
      message: "{{session_title}} starts at {{session_time}} on {{session_date}}.",
      buttonText: "Join now",
      subject: "Reminder: {{session_title}}",
      emailBody: "Hi {{user_name}},\n\n{{session_title}} starts soon.",
      emailButtonText: "Join now",
    },
  });
  const owner = await makeUser();
  remember(owner);
  remember(verified);
  remember(unverified);
  const service = serviceFor();
  const group = await service.createGroup({ actorUserId: owner.id, title: "Reminder group", courseId: "course-1", about: "Reminder routing." });
  await service.joinGroup({ actorUserId: verified.id, groupId: group.id });
  await service.joinGroup({ actorUserId: unverified.id, groupId: group.id });
  const session = await service.scheduleSession({
    actorUserId: owner.id, groupId: group.id, title: "Reminder routed session",
    startsAt: minutesFromNow(5), durationSeconds: 1800, maxParticipants: 4,
  });
  await service.planToAttend({ actorUserId: verified.id, sessionId: session.id });
  await service.planToAttend({ actorUserId: unverified.id, sessionId: session.id });

  const beforeMails = mails.length;
  await service.dispatchDueReminders();

  for (const user of [verified, unverified]) {
    const rows = await rowsFor(user.id, "LIVE_SESSION_REMINDER");
    assert.equal(rows.length, 1, `${user.email} gets one reminder row`);
    assert.equal(rows[0].title, "Soon: Reminder routed session");
    assert.match(rows[0].body, /starts at/);
    assert.equal(rows[0].sessionId, session.id);
  }
  const sent = mails.slice(beforeMails);
  assert.equal(sent.some((mail) => mail.to === unverified.email), false, "the unverified address is never mailed");
  const verifiedMail = sent.find((mail) => mail.to === verified.email);
  assert.ok(verifiedMail, "the verified member is mailed");
  assert.equal(verifiedMail.subject, "Reminder: Reminder routed session");

  const data = await store.ensureProductData();
  const unverifiedMailLog = (data.notificationLog || []).find(
    (item) => item.userId === unverified.id && item.channel === "email" && item.status === "failed",
  );
  assert.equal(unverifiedMailLog?.failureReason, "email not verified");
});

test("a switched-off reminder produces no in-app or email row on dispatch", async () => {
  const user = await makeUser();
  await setTemplate("LIVE_SESSION_REMINDER", { enabled: false });
  const owner = await makeUser();
  const { service, group } = await groupWithMember(owner, user, "Off reminder group");
  const session = await service.scheduleSession({
    actorUserId: owner.id, groupId: group.id, title: "Off reminder session",
    startsAt: minutesFromNow(5), durationSeconds: 1800, maxParticipants: 4,
  });
  await service.planToAttend({ actorUserId: user.id, sessionId: session.id });

  const beforeMails = mails.length;
  await service.dispatchDueReminders();

  assert.equal((await rowsFor(user.id, "LIVE_SESSION_REMINDER")).length, 0, "no in-app row while off");
  assert.equal(mails.length, beforeMails, "no email while off");
  const data = await store.ensureProductData();
  const emailLogs = (data.notificationLog || []).filter((item) => item.userId === user.id && item.channel === "email" && item.status !== "failed");
  assert.equal(emailLogs.length, 0);
});

test("LIVE_SESSION_CANCELLED and LIVE_SESSION_RESCHEDULED obey their switches", async () => {
  const user = await makeUser();
  const owner = await makeUser();
  const { service, group } = await groupWithMember(owner, user, "Switch group");
  const session = await service.scheduleSession({
    actorUserId: owner.id, groupId: group.id, title: "Switch session",
    startsAt: minutesFromNow(120), durationSeconds: 1800, maxParticipants: 4,
  });
  await service.planToAttend({ actorUserId: user.id, sessionId: session.id });
  const beforeMoveMailCount = mails.length;

  // Rescheduled is off by default: the move sends nothing.
  await setTemplate("LIVE_SESSION_RESCHEDULED", { enabled: false });
  await service.editSession({ actorUserId: owner.id, groupId: group.id, sessionId: session.id, startsAt: minutesFromNow(180) });
  assert.equal((await rowsFor(user.id, "LIVE_SESSION_RESCHEDULED")).length, 0, "rescheduled off: no row");

  await setTemplate("LIVE_SESSION_RESCHEDULED", {
    enabled: true,
    en: { title: "Moved: {{session_title}}", message: "{{session_title}} moved to {{session_time}} on {{session_date}}.", buttonText: "View session" },
  });
  await service.editSession({ actorUserId: owner.id, groupId: group.id, sessionId: session.id, startsAt: minutesFromNow(240) });
  let moved = await rowsFor(user.id, "LIVE_SESSION_RESCHEDULED");
  assert.equal(moved.length, 1);
  assert.equal(moved[0].title, "Moved: Switch session");
  const memberInbox = await notifications.listLearnerNotifications(user.id);
  const visibleMove = memberInbox.items.filter((item) => item.templateId === "LIVE_SESSION_RESCHEDULED");
  assert.equal(visibleMove.length, 1, "the actual learner inbox contains the moved session");
  assert.ok(visibleMove[0].buttonLink?.endsWith(`/sessions/${session.id}`));
  assert.equal((await notifications.listLearnerNotifications(owner.id)).items.some(
    (item) => item.templateId === "LIVE_SESSION_RESCHEDULED",
  ), false, "the host is not notified");
  assert.equal(mails.length, beforeMoveMailCount, "reschedule itself schedules no email");

  // Cancelled on: one row; then a second scenario with it off sends nothing.
  await setTemplate("LIVE_SESSION_CANCELLED", { enabled: true });
  await service.cancelSession({ actorUserId: owner.id, sessionId: session.id });
  assert.equal((await rowsFor(user.id, "LIVE_SESSION_CANCELLED")).length, 1);

  const session2 = await service.scheduleSession({
    actorUserId: owner.id, groupId: group.id, title: "Off cancel session",
    startsAt: minutesFromNow(120), durationSeconds: 1800, maxParticipants: 4,
  });
  await service.planToAttend({ actorUserId: user.id, sessionId: session2.id });
  await setTemplate("LIVE_SESSION_CANCELLED", { enabled: false });
  await service.cancelSession({ actorUserId: owner.id, sessionId: session2.id });
  assert.equal((await rowsFor(user.id, "LIVE_SESSION_CANCELLED")).length, 1, "cancelled off: no new row");
});

test("the reminders strip recognises template-routed rows, not only legacy titles", async () => {
  const user = await makeUser();
  const owner = await makeUser();
  const { service, group } = await groupWithMember(owner, user, "Strip group");
  const session = await service.scheduleSession({
    actorUserId: owner.id, groupId: group.id, title: "Strip session",
    startsAt: minutesFromNow(5), durationSeconds: 1800, maxParticipants: 4,
  });
  await service.planToAttend({ actorUserId: user.id, sessionId: session.id });
  await setTemplate("LIVE_SESSION_REMINDER", { enabled: true });
  await service.dispatchDueReminders();

  const data = await store.ensureProductData();
  const row = data.notifications.find((item) => item.userId === user.id && item.templateId === "LIVE_SESSION_REMINDER");
  assert.ok(row, "template-routed reminder row exists");
  const listed = await store.listStudyGroupReminders(user.id, () => true, user.locale);
  assert.ok(listed.some((item) => item.sessionId === session.id), "the strip lists the template-routed reminder");
});
