import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import nodemailer from "nodemailer";
import en from "../../messages/en-GB.json";
import zh from "../../messages/zh-CN.json";
import { courseAccessHref, sessionEntryAccessGained, sessionEntryRecheckMs, sessionOpensAtLabel, sessionToEnterFromQuery, studyGroupListHref, studySessionHref } from "../../components/portal/studyGroupClient";
import { sessionEntryNext, type SessionEntryFacts } from "../../modules/group-study/entry";
import { createStudyGroupRepository, type StudyGroupRepository } from "../../modules/group-study/repository";
import { createStudyGroupService, type StudyGroupService } from "../../modules/group-study/service";
import { uniqueReminderBodies } from "../../modules/group-study/uiState";

// SG deep links, confirmed with the owner 2026-10-30: one server answer for
// where a link to a Live Session sends the viewer; legal states go on in one
// click, nobody enters before the Host starts (members wait in the list's
// waiting dialog, the Host starts from the list), illegal states stop on a
// page that says why.

const NOW = "2026-09-19T02:00:00.000Z";
const GROUP_ID = "0f8b6c1e-6d3a-4f43-9a51-2b7c1f0e9d11";
const SESSION_ID = "7a1c2e9b-3f4d-4b8a-8c2e-5d6f7a8b9c0d";
let directory: string;
let repository: StudyGroupRepository;
let service: StudyGroupService;
let clock: string;
let published: boolean;
const access = new Set<string>();
const mails: Array<{ to: string; subject: string; text: string; link?: string | null }> = [];

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-deep-link-"));
  clock = NOW;
  published = true;
  access.clear();
  access.add("host:course-1");
  mails.length = 0;
  repository = createStudyGroupRepository(directory);
  service = createStudyGroupService({
    repository,
    now: () => new Date(clock),
    hasCourseAccess: async (userId, courseId) => access.has(`${userId}:${courseId}`),
    courseSummary: async (courseId) => courseId === "course-1" && published ? { id: courseId, title: "Modeling Life", slug: "modeling-life" } : null,
    accessibleCourses: async () => [],
    userProfile: async (userId) => ({ id: userId, displayName: userId, email: `${userId}@example.test`, locale: userId === "zh" ? "zh-CN" : "en-GB" }),
    notify: async () => undefined,
    listReminders: async () => [],
    sendMail: async (input) => { mails.push(input); },
    sessionLink: (sessionId, locale) => `https://lg.example.test/${locale}/portal/study-groups/sessions/${sessionId}`,
    liveKit: { apiKey: "lk-key", apiSecret: "lk-secret-at-least-32-characters", url: "wss://livekit.example.test" },
    tokenLogKey: () => Buffer.alloc(32, 7)
  });
});

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function groupWithSession(startsAt: string, maxParticipants = 4) {
  const group = await service.createGroup({ actorUserId: "host", title: "Modeling", courseId: "course-1", about: "About modeling." });
  for (const userId of ["m1", "m2", "m3"]) {
    access.add(`${userId}:course-1`);
    await service.joinGroup({ actorUserId: userId, groupId: group.id });
  }
  const session = await service.scheduleSession({ actorUserId: "host", groupId: group.id, title: "Lesson 1 Lecture", startsAt, durationSeconds: 1200, maxParticipants, focus: "Two genotypes" });
  return { group, session };
}

const facts = (overrides: Partial<SessionEntryFacts>): SessionEntryFacts => ({
  signedIn: true, found: true, state: "live", missed: false, courseAvailable: true, courseAccess: true, member: true, host: false, seatForViewer: true, ...overrides
});

test("the entry rule checks in order and never offers a purchase or a join that cannot work", () => {
  assert.equal(sessionEntryNext(facts({ signedIn: false, found: false, state: null })), "sign_in");
  assert.equal(sessionEntryNext(facts({ found: false, state: null })), "unavailable");
  assert.equal(sessionEntryNext(facts({ state: "completed", courseAccess: false, member: false })), "ended");
  assert.equal(sessionEntryNext(facts({ state: "starting_soon", missed: true, member: false })), "ended");
  assert.equal(sessionEntryNext(facts({ courseAccess: false })), "course_access");
  assert.equal(sessionEntryNext(facts({ courseAccess: false, courseAvailable: false })), "course_unavailable");
  assert.equal(sessionEntryNext(facts({ member: false })), "join_group");
  assert.equal(sessionEntryNext(facts({ member: false, courseAvailable: false })), "course_unavailable");
  // A member who still holds a Course no longer offered keeps entering.
  assert.equal(sessionEntryNext(facts({ courseAvailable: false })), "enter");
  assert.equal(sessionEntryNext(facts({ state: "scheduled", host: true })), "not_open");
  assert.equal(sessionEntryNext(facts({ state: "starting_soon" })), "wait");
  assert.equal(sessionEntryNext(facts({ state: "starting_soon", host: true, seatForViewer: false })), "host_start");
  assert.equal(sessionEntryNext(facts({ state: "starting_soon", seatForViewer: false })), "full");
  assert.equal(sessionEntryNext(facts({ state: "live", seatForViewer: false })), "full");
  assert.equal(sessionEntryNext(facts({ state: "live", host: true })), "enter");
});

test("a signed-out visitor and a session that is gone learn nothing about the session", async () => {
  const { session } = await groupWithSession("2026-09-19T12:00:00.000Z");
  // A signed-out visitor costs no store read either.
  const read = repository.read.bind(repository);
  let reads = 0;
  repository.read = async () => { reads += 1; return read(); };
  const signedOut = await service.sessionEntry({ actorUserId: null, sessionId: session.id });
  assert.deepEqual(signedOut, { next: "sign_in", now: NOW, opensAt: null, viewer: null, session: null, group: null, course: null });
  assert.equal(reads, 0);
  const missing = await service.sessionEntry({ actorUserId: "m1", sessionId: SESSION_ID });
  assert.deepEqual(missing, { next: "unavailable", now: NOW, opensAt: null, viewer: null, session: null, group: null, course: null });
  await service.cancelSession({ actorUserId: "host", sessionId: session.id });
  const cancelled = await service.sessionEntry({ actorUserId: "m1", sessionId: session.id });
  assert.deepEqual(cancelled, { next: "unavailable", now: NOW, opensAt: null, viewer: null, session: null, group: null, course: null });
});

test("a cancelled Study Group makes its session links unavailable", async () => {
  const { group, session } = await groupWithSession("2026-09-19T12:00:00.000Z");
  await service.cancelGroup({ actorUserId: "host", groupId: group.id });
  const entry = await service.sessionEntry({ actorUserId: "m1", sessionId: session.id });
  assert.deepEqual(entry, { next: "unavailable", now: NOW, opensAt: null, viewer: null, session: null, group: null, course: null });
});

test("members before T-10 see when the room opens, whether they planned, and the Host is told to start from the list", async () => {
  const { group, session } = await groupWithSession("2026-09-19T12:00:00.000Z");
  const member = await service.sessionEntry({ actorUserId: "m1", sessionId: session.id });
  assert.equal(member.next, "not_open");
  assert.equal(member.opensAt, "2026-09-19T11:50:00.000Z");
  assert.deepEqual(member.viewer, { host: false, planned: false });
  // Only the group's id goes out, for the way on.
  assert.deepEqual(member.group, { id: group.id });
  assert.equal(member.now, NOW);
  assert.deepEqual(member.course, { id: "course-1", title: "Modeling Life", slug: "modeling-life" });
  await service.planToAttend({ actorUserId: "m1", sessionId: session.id });
  assert.equal((await service.sessionEntry({ actorUserId: "m1", sessionId: session.id })).viewer?.planned, true);
  const host = await service.sessionEntry({ actorUserId: "host", sessionId: session.id });
  assert.equal(host.next, "not_open");
  assert.deepEqual(host.viewer, { host: true, planned: false });
});

test("Starting Soon sends a member to the list's waiting dialog and the Host to the list's Start; nobody is seated by asking", async () => {
  const { session } = await groupWithSession("2026-09-19T02:05:00.000Z");
  assert.equal((await service.sessionEntry({ actorUserId: "m1", sessionId: session.id })).next, "wait");
  assert.equal((await service.sessionEntry({ actorUserId: "host", sessionId: session.id })).next, "host_start");
  // Asking where a link goes never takes a seat: the waiting dialog does.
  assert.equal((await service.getSession({ actorUserId: "m1", sessionId: session.id })).occupancy, 0);
  await service.startSession({ actorUserId: "host", sessionId: session.id });
  const live = await service.sessionEntry({ actorUserId: "m1", sessionId: session.id });
  assert.equal(live.next, "enter");
  assert.equal(live.session?.state, "live");
  assert.equal(live.session?.occupancy, 1);
  assert.equal((await service.sessionEntry({ actorUserId: "host", sessionId: session.id })).next, "enter");
});

test("a full session stops a member, keeps the Host's seat before the start, and lets a seated member back in", async () => {
  const { session } = await groupWithSession("2026-09-19T02:05:00.000Z", 2);
  await service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: NOW });
  // One seat waits with m1, the other is the Host's until the start.
  assert.equal((await service.sessionEntry({ actorUserId: "m2", sessionId: session.id })).next, "full");
  assert.equal((await service.sessionEntry({ actorUserId: "m1", sessionId: session.id })).next, "wait");
  assert.equal((await service.sessionEntry({ actorUserId: "host", sessionId: session.id })).next, "host_start");
  await service.startSession({ actorUserId: "host", sessionId: session.id });
  const full = await service.sessionEntry({ actorUserId: "m2", sessionId: session.id });
  assert.equal(full.next, "full");
  assert.equal(full.session?.occupancy, 2);
  assert.equal((await service.sessionEntry({ actorUserId: "m1", sessionId: session.id })).next, "enter");
});

test("without the Course a learner is sent to buy it, and once bought to join and carry on", async () => {
  const { session } = await groupWithSession("2026-09-19T02:05:00.000Z");
  const buyer = await service.sessionEntry({ actorUserId: "outsider", sessionId: session.id });
  assert.equal(buyer.next, "course_access");
  // Figma Deep Link 03: what the session is, never who is in it.
  assert.equal(buyer.session?.title, "Lesson 1 Lecture");
  assert.equal(buyer.session?.focus, "Two genotypes");
  assert.equal(buyer.session?.maxParticipants, 4);
  assert.equal(buyer.session?.occupancy, null);
  assert.deepEqual(buyer.course, { id: "course-1", title: "Modeling Life", slug: "modeling-life" });
  assert.deepEqual(buyer.viewer, { host: false, planned: false });
  access.add("outsider:course-1");
  assert.equal((await service.sessionEntry({ actorUserId: "outsider", sessionId: session.id })).next, "join_group");
  const group = (await repository.read()).sessions.find((item) => item.id === session.id)!.groupId;
  await service.joinGroup({ actorUserId: "outsider", groupId: group });
  assert.equal((await service.sessionEntry({ actorUserId: "outsider", sessionId: session.id })).next, "wait");
});

test("a Course no longer offered is never sold or joined, while a member who holds it keeps entering", async () => {
  const { session } = await groupWithSession("2026-09-19T02:05:00.000Z");
  await service.startSession({ actorUserId: "host", sessionId: session.id });
  published = false;
  const outsider = await service.sessionEntry({ actorUserId: "outsider", sessionId: session.id });
  assert.equal(outsider.next, "course_unavailable");
  assert.equal(outsider.course, null);
  // Nothing of a group that is no longer listed anywhere.
  assert.equal(outsider.group, null);
  assert.equal(outsider.session?.occupancy, null);
  access.add("buyer:course-1");
  assert.equal((await service.sessionEntry({ actorUserId: "buyer", sessionId: session.id })).next, "course_unavailable");
  assert.equal((await service.sessionEntry({ actorUserId: "m1", sessionId: session.id })).next, "enter");
});

test("an ended session says so to members and non-members alike, including one that was never started", async () => {
  const { session } = await groupWithSession("2026-09-19T02:05:00.000Z");
  clock = "2026-09-19T02:26:00.000Z";
  for (const userId of ["m1", "outsider", "host"]) {
    const entry = await service.sessionEntry({ actorUserId: userId, sessionId: session.id });
    assert.equal(entry.next, "ended", userId);
    // Never started: it keeps its state, so the page can say "Not started".
    assert.equal(entry.session?.state, "starting_soon", userId);
    assert.equal(entry.session?.occupancy, userId === "outsider" ? null : 0, userId);
  }
  const { session: held } = await groupWithSession("2026-09-19T02:30:00.000Z");
  await service.startSession({ actorUserId: "host", sessionId: held.id });
  // The last one out ends a live session.
  await service.leaveSession({ actorUserId: "host", sessionId: held.id });
  for (const userId of ["m1", "outsider"]) {
    const entry = await service.sessionEntry({ actorUserId: userId, sessionId: held.id });
    assert.equal(entry.next, "ended", userId);
    assert.equal(entry.session?.state, "completed", userId);
  }
});

test("the T-10 reminder mail carries the session's own link in the recipient's language", async () => {
  const { session } = await groupWithSession("2026-09-19T02:05:00.000Z");
  await service.planToAttend({ actorUserId: "m1", sessionId: session.id }).catch(() => undefined);
  await service.dispatchDueRemindersOnRequest();
  const hostMail = mails.find((item) => item.to === "host@example.test");
  assert.ok(hostMail, "the Host is always reminded");
  assert.equal(hostMail.link, `https://lg.example.test/en-GB/portal/study-groups/sessions/${session.id}`);
});

test("client helpers: the list address, the one-time ?enter=, the purchase link and when a stopped page asks again", () => {
  assert.equal(studySessionHref("en-GB", SESSION_ID), `/en-GB/portal/study-groups/sessions/${SESSION_ID}`);
  assert.equal(studyGroupListHref("zh-CN", GROUP_ID), `/zh-CN/portal/study-groups?group=${GROUP_ID}`);
  assert.equal(studyGroupListHref("en-GB", GROUP_ID, SESSION_ID), `/en-GB/portal/study-groups?group=${GROUP_ID}&enter=${SESSION_ID}`);
  assert.equal(sessionToEnterFromQuery(`?group=${GROUP_ID}&enter=${SESSION_ID}`), SESSION_ID);
  assert.equal(sessionToEnterFromQuery("?enter=../api/admin"), null);
  assert.equal(sessionToEnterFromQuery(`?group=${GROUP_ID}`), null);
  assert.equal(courseAccessHref("en-GB", "course 1"), "/en-GB/subscription?courseId=course%201");
  // Timed by the server's clock (`now`), never the device's.
  assert.equal(sessionEntryRecheckMs({ next: "not_open", now: NOW, opensAt: "2026-09-19T02:00:20.000Z" }), 20_500);
  assert.equal(sessionEntryRecheckMs({ next: "not_open", now: NOW, opensAt: "2026-09-19T12:00:00.000Z" }), 60_000);
  assert.equal(sessionEntryRecheckMs({ next: "not_open", now: NOW, opensAt: "2026-09-19T01:00:00.000Z" }), 2_000);
  assert.equal(sessionEntryRecheckMs({ next: "not_open", now: NOW, opensAt: null }), 60_000);
  assert.equal(sessionEntryRecheckMs({ next: "not_open", now: "garbage", opensAt: "2026-09-19T02:00:20.000Z" }), 60_000);
  assert.equal(sessionEntryRecheckMs({ next: "full", now: NOW, opensAt: null }), 15_000);
  // Course access bought in the other tab arrives even without a focus event.
  assert.equal(sessionEntryRecheckMs({ next: "course_access", now: NOW, opensAt: null }), 10_000);
  for (const next of ["sign_in", "unavailable", "ended", "course_unavailable", "join_group", "wait", "host_start", "enter"] as const) {
    assert.equal(sessionEntryRecheckMs({ next, now: NOW, opensAt: null }), null, next);
    assert.equal(sessionEntryRecheckMs({ next, now: NOW, opensAt: null }, 3), null, next);
  }
  // Failed asks back off: 5 s, 10 s, 20 s... never past a minute, never sooner than the plan.
  assert.equal(sessionEntryRecheckMs({ next: "not_open", now: NOW, opensAt: "2026-09-19T02:00:01.000Z" }, 1), 5_000);
  assert.equal(sessionEntryRecheckMs({ next: "course_access", now: NOW, opensAt: null }, 2), 10_000);
  assert.equal(sessionEntryRecheckMs({ next: "full", now: NOW, opensAt: null }, 3), 20_000);
  assert.equal(sessionEntryRecheckMs({ next: "full", now: NOW, opensAt: null }, 4), 40_000);
  assert.equal(sessionEntryRecheckMs({ next: "full", now: NOW, opensAt: null }, 9), 60_000);
  // "Opens at": the time today, the day as well otherwise.
  const today = sessionOpensAtLabel("en-GB", "2026-09-19T11:50:00.000Z", Date.parse("2026-09-19T11:00:00.000Z"));
  const tomorrow = sessionOpensAtLabel("en-GB", "2026-09-20T11:50:00.000Z", Date.parse("2026-09-19T11:00:00.000Z"));
  assert.doesNotMatch(today, /Sept?|20/);
  assert.match(tomorrow, /20 Sept?/);
  assert.equal(sessionEntryAccessGained("course_access", "join_group"), true);
  assert.equal(sessionEntryAccessGained("course_access", "wait"), true);
  assert.equal(sessionEntryAccessGained("course_access", "course_access"), false);
  assert.equal(sessionEntryAccessGained(null, "join_group"), false);
});

test("the session page asks the entry check first; the room no longer waits or starts, the list takes over", () => {
  const page = readFileSync(new URL("../../app/[locale]/portal/study-groups/sessions/[sessionId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<StudySessionEntry locale=\{locale\} sessionId=\{sessionId\} \/>/);
  const entry = readFileSync(new URL("../../components/portal/StudySessionEntry.tsx", import.meta.url), "utf8");
  assert.match(entry, /\/api\/study-groups\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/entry/);
  assert.match(entry, /if \(entry\.next === "wait"\) router\.replace\(studyGroupListHref\(locale, entry\.group\.id, sessionId\)\);/);
  assert.match(entry, /else if \(entry\.next === "host_start"\) router\.replace\(studyGroupListHref\(locale, entry\.group\.id\)\);/);
  assert.match(entry, /if \(entry\?\.next === "enter"\) return <StudySessionRoom locale=\{locale\} sessionId=\{sessionId\} onNotLive=/);
  assert.match(entry, /href=\{courseAccessHref\(locale, course\.id\)\} target="_blank" rel="noopener noreferrer"/);
  assert.match(entry, /document\.addEventListener\("visibilitychange", wake\)/);
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.equal(room.includes("startSession"), false);
  assert.equal(room.includes("/start`"), false);
  assert.equal(room.includes("copy.waiting"), false);
  assert.match(room, /if \(session\.state !== "live"\) \{\n      setEntryDone\(true\);/);
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /const entering = signedIn \? sessionToEnterFromQuery\(window\.location\.search\) : null;/);
  assert.match(app, /dropEnterFromAddress\(\);\n      void followEntry\(entering\);/);
  assert.match(app, /if \(entry\.data\.next !== "wait"\) return;/);
  // Enter now names its reminder for a screen reader and works once at a time.
  assert.match(app, /<li role="status" key=\{item\.sessionId \?\? `\$\{item\.createdAt\}-\$\{item\.body\}`\}><span id=\{`study-group-reminder-\$\{index\}`\}>\{item\.body\}<\/span>/);
  assert.match(app, /item\.sessionId \? <button className=\{styles\.reminderLink\} type="button" aria-describedby=\{`study-group-reminder-\$\{index\}`\} disabled=\{following !== null\} aria-busy=\{following === item\.sessionId\} onClick=\{\(\) => void followEntry\(item\.sessionId!\)\}>\{copy\.deepLink\.enterNow\}<\/button>/);
  // A Enter now that cannot open the waiting dialog falls back to the session page, which says why.
  assert.match(app, /if \(!current\.ok \|\| !await enter\(current\.data\)\) router\.push\(studySessionHref\(locale, sessionId\)\);/);
});

test("the deep-link copy exists in both languages with the same keys", () => {
  assert.deepEqual(Object.keys(en.studyGroupsPage.deepLink).sort(), Object.keys(zh.studyGroupsPage.deepLink).sort());
  assert.equal(en.studyGroupsPage.deepLink.joinAction, "Join Study Group & Continue");
  assert.equal(en.studyGroupsPage.deepLink.accessTitle, "Course access required");
  assert.equal(en.studyGroupsPage.deepLink.accessAction, "Get Course Access");
  assert.equal(zh.studyGroupsPage.deepLink.enterNow, "立即进入");
});

test("leaving the Study Group turns a member into a non-member at once: join first, no count; rejoining carries on", async () => {
  const { group, session } = await groupWithSession("2026-09-19T02:05:00.000Z");
  await service.leaveGroup({ actorUserId: "m1", groupId: group.id });
  const left = await service.sessionEntry({ actorUserId: "m1", sessionId: session.id });
  assert.equal(left.next, "join_group");
  assert.equal(left.session?.occupancy, null);
  assert.deepEqual(left.viewer, { host: false, planned: false });
  await service.joinGroup({ actorUserId: "m1", groupId: group.id });
  assert.equal((await service.sessionEntry({ actorUserId: "m1", sessionId: session.id })).next, "wait");
});

test("what a non-member is told is a fixed set of fields: never members, the count, or anything of the group but its id", async () => {
  const { session } = await groupWithSession("2026-09-19T02:05:00.000Z");
  await service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: NOW });
  access.add("joiner:course-1");
  for (const userId of ["outsider", "joiner"]) {
    const entry = await service.sessionEntry({ actorUserId: userId, sessionId: session.id });
    assert.deepEqual(Object.keys(entry).sort(), ["course", "group", "next", "now", "opensAt", "session", "viewer"], userId);
    assert.deepEqual(Object.keys(entry.session ?? {}).sort(), ["durationSeconds", "focus", "id", "maxParticipants", "occupancy", "startsAt", "state", "title"], userId);
    assert.deepEqual(Object.keys(entry.group ?? {}), ["id"], userId);
    assert.equal(entry.session?.occupancy, null, userId);
    assert.equal(JSON.stringify(entry).includes("m1"), false, userId);
  }
  // A member sees the count, like the group's session list.
  assert.equal((await service.sessionEntry({ actorUserId: "m2", sessionId: session.id })).session?.occupancy, 1);
});

test("a reminder mail to a Chinese-speaking member links the Chinese session page", async () => {
  const { group, session } = await groupWithSession("2026-09-19T02:05:00.000Z");
  access.add("zh:course-1");
  await service.joinGroup({ actorUserId: "zh", groupId: group.id });
  await service.planToAttend({ actorUserId: "zh", sessionId: session.id }).catch(() => undefined);
  await service.dispatchDueRemindersOnRequest();
  const zhMail = mails.find((item) => item.to === "zh@example.test");
  assert.ok(zhMail, "a member who planned is reminded");
  assert.equal(zhMail.link, `https://lg.example.test/zh-CN/portal/study-groups/sessions/${session.id}`);
});

test("the reminder mail puts the session link on its own labelled line, plain text, in the recipient's language", async () => {
  const env = { ...process.env };
  const sent: Array<Record<string, unknown>> = [];
  const create = mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (message: Record<string, unknown>) => { sent.push(message); return { accepted: [message.to], rejected: [], messageId: "<id@test>" }; }
  }));
  const info = mock.method(console, "info", () => undefined);
  try {
    Object.assign(process.env, { SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_USER: "study@example.test", SMTP_PASS: "local-test", SMTP_FROM: "study@example.test" });
    const { sendStudyGroupReminderEmail } = await import("../../services/emailService");
    const link = `https://lg.example.test/en-GB/portal/study-groups/sessions/${SESSION_ID}`;
    await sendStudyGroupReminderEmail({ to: "m1@example.test", subject: "Live Session reminder", text: "Lesson 1 starts in 10 minutes.", link, locale: "en-GB" });
    await sendStudyGroupReminderEmail({ to: "zh@example.test", subject: "直播课提醒", text: "Lesson 1 将在 10 分钟后开始。", link: link.replace("/en-GB/", "/zh-CN/"), locale: "zh-CN" });
    await sendStudyGroupReminderEmail({ to: "m2@example.test", subject: "Live Session reminder", text: "Lesson 1 starts in 10 minutes.", link: null, locale: "en-GB" });
    assert.equal(sent.length, 3);
    assert.equal(sent[0].text, `Lesson 1 starts in 10 minutes.\n\nEnter Live Session: ${link}`);
    assert.equal(sent[1].text, `Lesson 1 将在 10 分钟后开始。\n\n进入直播课: ${link.replace("/en-GB/", "/zh-CN/")}`);
    // No link configured: the reminder goes out unchanged.
    assert.equal(sent[2].text, "Lesson 1 starts in 10 minutes.");
    for (const message of sent) assert.equal(message.html, undefined);
  } finally {
    create.mock.restore();
    info.mock.restore();
    process.env = env;
  }
});

test("the session link uses the public Portal origin; a managed environment without one sends no link and says so once", async () => {
  const env = { ...process.env };
  const warn = mock.method(console, "warn", () => undefined);
  try {
    const { studyGroupSessionLink } = await import("../../modules/group-study/runtime");
    Object.assign(process.env, { APP_ENV: "SIT", NEXT_PUBLIC_APP_URL: "https://sit.example.test/" });
    assert.equal(studyGroupSessionLink("a/b c", "zh-CN"), "https://sit.example.test/zh-CN/portal/study-groups/sessions/a%2Fb%20c");
    process.env.APP_ENV = "DEV";
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(studyGroupSessionLink(SESSION_ID, "en-GB"), `http://localhost:3000/en-GB/portal/study-groups/sessions/${SESSION_ID}`);
    process.env.APP_ENV = "UAT";
    assert.equal(studyGroupSessionLink(SESSION_ID, "en-GB"), null);
    assert.equal(studyGroupSessionLink(SESSION_ID, "zh-CN"), null);
    const warned = warn.mock.calls.filter((call) => String(call.arguments[0]).includes("session_link_unavailable"));
    assert.equal(warned.length, 1);
  } finally {
    warn.mock.restore();
    process.env = env;
  }
});

test("every deep-link line has the same placeholders in both languages", () => {
  const english: Record<string, string> = en.studyGroupsPage.deepLink;
  const chinese: Record<string, string> = zh.studyGroupsPage.deepLink;
  const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(english)) assert.deepEqual(holes(chinese[key]), holes(english[key]), key);
  assert.deepEqual(holes(english.notOpenTitle), ["time"]);
  assert.deepEqual(holes(english.fullBody), []);
});

test("two reminders for different sessions with the same wording each keep their own Enter now", () => {
  const rows = [
    { body: "Lesson 1 starts in 10 minutes.", createdAt: NOW, sessionId: "a" },
    { body: "Lesson 1 starts in 10 minutes.", createdAt: NOW, sessionId: "b" }
  ];
  assert.deepEqual(uniqueReminderBodies(rows).map((item) => item.sessionId), ["a", "b"]);
});
