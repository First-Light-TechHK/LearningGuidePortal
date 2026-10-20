import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { LiveKitRoomGateway } from "../../modules/group-study/liveKitGateway";
import { parseLiveKitProjects } from "../../modules/group-study/liveKitProjectRegistry";
import { createStudyGroupRepository, type StudyGroupRepository } from "../../modules/group-study/repository";
import { createStudyGroupService, type StudyGroupDeps, type StudyGroupService } from "../../modules/group-study/service";

// The server half of the QA 2026-10-19 final review's remaining items
// (round 2): each test is named after the item it locks.

const START = "2026-10-20T10:00:00.000Z";
const tokenLogKey = Buffer.alloc(32, 7);
const directories: string[] = [];

afterEach(async () => {
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true });
});

const PROJECTS_JSON = JSON.stringify([
  { id: "eu-primary", url: "wss://eu-primary.livekit.cloud", state: "active", weight: 1, credentialSecretId: "lg/livekit/eu-primary" }
]);

type Fixture = {
  service: StudyGroupService;
  repository: StudyGroupRepository;
  clock: () => string;
  advanceSeconds: (seconds: number) => void;
  access: Set<string>;
  /** The provider's room membership (listParticipants); null fails the read, "hang" never answers. */
  participants: { list: string[] | null | "hang" };
  providerReads: string[];
  removed: Array<{ room: string; identity: string }>;
  notes: Array<{ userId: string; title: string; body: string; sessionId?: string; createdAt?: string }>;
  mails: Array<{ to: string; text: string }>;
  logs: Array<Record<string, unknown>>;
  /** Runs inside withdrawReminders before it deletes (a racing dispatch). */
  hooks: { beforeWithdraw?: () => Promise<void> };
};

async function fixture(extra: (base: Omit<Fixture, "service">) => Partial<StudyGroupDeps> = () => ({})): Promise<Fixture> {
  const directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-r2-"));
  directories.push(directory);
  const repository = createStudyGroupRepository(directory);
  let nowMs = Date.parse(START);
  const access = new Set(["host:course-1", "m1:course-1", "m2:course-1", "m3:course-1"]);
  const participants: Fixture["participants"] = { list: [] };
  const providerReads: string[] = [];
  const removed: Array<{ room: string; identity: string }> = [];
  const notes: Fixture["notes"] = [];
  const mails: Fixture["mails"] = [];
  const logs: Fixture["logs"] = [];
  const hooks: Fixture["hooks"] = {};
  const gateway: LiveKitRoomGateway = {
    ensureRoom: async () => undefined,
    issueParticipantToken: async () => ({ token: "stub-token", expiresAt: START, url: "wss://livekit.example.test" }),
    publishTutorMessage: async () => undefined,
    removeParticipant: async (input) => { removed.push({ room: input.room, identity: input.identity }); },
    healthCheck: async ({ project }) => ({ projectId: project.id, status: "healthy", evidence: "provider_api", providerVerified: true, checkedAt: START, latencyMs: 0 }),
    listParticipants: async ({ room }) => {
      providerReads.push(room);
      if (participants.list === "hang") return new Promise(() => undefined);
      if (!participants.list) throw new Error("provider unreachable");
      return participants.list.map((identity) => ({ identity }));
    }
  };
  const base = {
    repository,
    clock: () => new Date(nowMs).toISOString(),
    advanceSeconds: (seconds: number) => { nowMs += seconds * 1000; },
    access,
    participants,
    providerReads,
    removed,
    notes,
    mails,
    logs,
    hooks
  };
  const deps: StudyGroupDeps = {
    repository,
    now: () => new Date(nowMs),
    hasCourseAccess: async (userId, courseId) => access.has(`${userId}:${courseId}`),
    courseSummary: async (courseId) => courseId === "course-1" ? { id: courseId, title: "German History", slug: "german-history" } : null,
    accessibleCourses: async () => [],
    userProfile: async (userId) => ({ id: userId, displayName: userId === "host" ? "Anna Williams" : userId, email: `${userId}@example.test`, locale: "en-GB" }),
    notify: async (input) => { notes.push({ ...input, createdAt: new Date(nowMs).toISOString() }); },
    listReminders: async () => [],
    // The stored reminder notifications, withdrawn like productStore does.
    withdrawReminders: async (input) => {
      await hooks.beforeWithdraw?.();
      for (let index = notes.length - 1; index >= 0; index -= 1) {
        const note = notes[index];
        const sentBefore = !input.sentBefore || Date.parse(note.createdAt ?? "") < Date.parse(input.sentBefore);
        if (note.title === "Live Session reminder" && note.sessionId && input.sessionIds.includes(note.sessionId) && (!input.userId || note.userId === input.userId) && sentBefore) notes.splice(index, 1);
      }
    },
    sendMail: async (input) => { mails.push({ to: input.to, text: input.text }); },
    liveKit: { apiKey: "lk-key", apiSecret: "lk-secret-at-least-32-characters", url: "wss://livekit.example.test" },
    liveKitProjects: parseLiveKitProjects(PROJECTS_JSON),
    liveKitGateway: gateway,
    tokenLogKey: () => tokenLogKey,
    operationalLog: (event) => { logs.push(event); },
    ...extra(base)
  };
  return { ...base, service: createStudyGroupService(deps) };
}

async function group(f: Fixture, members = ["m1", "m2"]) {
  const created = await f.service.createGroup({ actorUserId: "host", title: "Round two", courseId: "course-1", about: "About round two." });
  for (const userId of members) await f.service.joinGroup({ actorUserId: userId, groupId: created.id });
  return created;
}

function inMinutes(f: Fixture, minutes: number) {
  return new Date(Date.parse(f.clock()) + minutes * 60_000).toISOString();
}

async function code(run: () => Promise<unknown>) {
  try {
    await run();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "error";
  }
}

test("F-1: the start seats the Host in the same write, so a member cannot take that seat before the Host enters", async () => {
  const f = await fixture();
  const created = await group(f);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Two seats", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 2 });
  await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() });
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: f.clock() })), "session_full");

  const started = await f.service.startSession({ actorUserId: "host", sessionId: session.id });
  assert.equal(started.occupancy, 2, "the Host holds a seat the moment the session is live");
  // Between /start and the Host's /enter a member's Join Now finds no seat.
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: f.clock() })), "session_full");
  f.advanceSeconds(2);
  assert.equal((await f.service.enterSession({ actorUserId: "host", sessionId: session.id, requestedAt: f.clock() })).occupancy, 2);
  const hostSeats = (await f.repository.read()).presences.filter((row) => row.sessionId === session.id && row.userId === "host");
  assert.equal(hostSeats.length, 1, "the Host's entry renews the seat the start created");
  assert.equal(hostSeats[0].lastSeenAt, f.clock());

  // A Host who never enters loses the seat one lease later like anyone else.
  const g = await fixture();
  const other = await group(g);
  const lone = await g.service.scheduleSession({ actorUserId: "host", groupId: other.id, title: "Lone start", startsAt: inMinutes(g, 5), durationSeconds: 1800, maxParticipants: 2 });
  await g.service.startSession({ actorUserId: "host", sessionId: lone.id });
  g.advanceSeconds(31);
  assert.equal((await g.service.getSession({ actorUserId: "host", sessionId: lone.id })).occupancy, 0);
});

test("F-2: the session view tells a member how many seats they can take, the Host's reserved seat subtracted", async () => {
  const f = await fixture();
  const created = await group(f, ["m1", "m2", "m3"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Three seats", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 3 });
  const open = async () => (await f.service.getSession({ actorUserId: "m3", sessionId: session.id })).seatsOpen;
  assert.equal(await open(), 2, "one of three is the Host's");
  await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() });
  assert.equal(await open(), 1);
  await f.service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: f.clock() });
  assert.equal((await f.service.getSession({ actorUserId: "m3", sessionId: session.id })).occupancy, 2, "2/3 seated");
  assert.equal(await open(), 0, "…and still full for a member: the last seat waits for the Host");
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m3", sessionId: session.id, requestedAt: f.clock() })), "session_full");

  // Live, the reservation is gone; the started room is full with the Host in it.
  await f.service.startSession({ actorUserId: "host", sessionId: session.id });
  assert.equal(await open(), 0);
  await f.service.leaveSession({ actorUserId: "m2", sessionId: session.id });
  assert.equal(await open(), 1);
  await f.service.leaveSession({ actorUserId: "m1", sessionId: session.id });
  await f.service.leaveSession({ actorUserId: "m3", sessionId: session.id }).catch(() => undefined);
  await f.service.leaveSession({ actorUserId: "host", sessionId: session.id });
  assert.equal((await f.service.getSession({ actorUserId: "m3", sessionId: session.id })).state, "completed");
  assert.equal(await open(), 0, "an ended session has no seat to offer");
});

test("F-2: the groups page disables Join Now from the server's seat count, not occupancy against the maximum", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(path.join(process.cwd(), "components/portal/StudyGroupsApp.tsx"), "utf8");
  // The rule itself (with the viewer's own seat) is sessionFullForViewer,
  // tested in study-group-groups-page.test.ts (QA3 groups #2).
  assert.match(app, /disabled=\{sessionFullForViewer\(session\)\}/);
  assert.match(app, /\{sessionFullForViewer\(session\) \? copy\.sessionFull : copy\.joinNow\}/);
  assert.equal(app.includes("session.occupancy >= session.maxParticipants"), false);
});

test("F-5: a schedule inside the submit window is a duplicate only when Focus, lesson and AI Tutor match too", async () => {
  const f = await fixture();
  const created = await group(f, []);
  const plan = { actorUserId: "host", groupId: created.id, title: "Same slot", startsAt: inMinutes(f, 60), durationSeconds: 1800, maxParticipants: 4, focus: "Weimar", relatedLessonId: "lesson-1", aiTutorEnabled: true };
  const first = await f.service.scheduleSession(plan);
  f.advanceSeconds(3);
  assert.equal((await f.service.scheduleSession({ ...plan, focus: " Weimar " })).id, first.id, "the same request again is the same session");
  const ids = new Set([first.id]);
  for (const change of [{ focus: "Versailles" }, { focus: "" }, { relatedLessonId: "lesson-2" }, { relatedLessonId: null }, { aiTutorEnabled: false }]) {
    const other = await f.service.scheduleSession({ ...plan, ...change });
    assert.equal(ids.has(other.id), false, `${JSON.stringify(change)} makes a new session`);
    ids.add(other.id);
  }
  const stored = (await f.repository.read()).sessions.filter((row) => row.title === "Same slot");
  assert.equal(stored.length, 6);
  assert.deepEqual(stored.map((row) => [row.focus, row.relatedLessonId, row.aiTutorEnabled]), [
    ["Weimar", "lesson-1", true], ["Versailles", "lesson-1", true], [null, "lesson-1", true], ["Weimar", "lesson-2", true], ["Weimar", null, true], ["Weimar", "lesson-1", false]
  ]);
});

async function heartbeats(f: Fixture, sessionId: string, users: string[], seconds: number) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 10) {
    f.advanceSeconds(Math.min(10, seconds - elapsed));
    for (const userId of users) await f.service.heartbeat({ actorUserId: userId, sessionId });
  }
}

test("B6: a waiting room left open past the planned end stops renewing, so the session cannot start hours late", async () => {
  const f = await fixture();
  const created = await group(f);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Never started", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 4 });
  await f.service.enterSession({ actorUserId: "host", sessionId: session.id, requestedAt: f.clock() });
  await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() });
  // Up to the planned end (start + 30 min) the waiting seats renew.
  await heartbeats(f, session.id, ["host", "m1"], 35 * 60 - 10);
  assert.equal((await f.service.getSession({ actorUserId: "m1", sessionId: session.id })).occupancy, 2);
  f.advanceSeconds(10);
  assert.deepEqual(await f.service.heartbeat({ actorUserId: "m1", sessionId: session.id }), { seated: false, occupancy: 1, state: "starting_soon" });
  assert.equal((await f.service.heartbeat({ actorUserId: "host", sessionId: session.id })).seated, false);
  const seats = (await f.repository.read()).presences.filter((row) => row.sessionId === session.id);
  assert.deepEqual(seats.map((row) => row.leftAt), [f.clock(), f.clock()], "both seats are released now, not renewed");
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() })), "session_not_open");
  assert.equal(await code(() => f.service.startSession({ actorUserId: "host", sessionId: session.id })), "session_not_open");
  f.advanceSeconds(3 * 60 * 60);
  assert.equal(await code(() => f.service.startSession({ actorUserId: "host", sessionId: session.id })), "session_not_open");
});

test("B6: entering again while seated past the planned end releases the seat instead of renewing it", async () => {
  const f = await fixture();
  const created = await group(f);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Late re-entry", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 4 });
  await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() });
  await heartbeats(f, session.id, ["m1"], 35 * 60);
  // The seat is still held (renewed 10 s before the end), but the room is closed.
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() })), "session_not_open");
  assert.equal((await f.repository.read()).presences.find((row) => row.sessionId === session.id)?.leftAt, f.clock());
  assert.equal((await f.service.getSession({ actorUserId: "m1", sessionId: session.id })).occupancy, 0);
});

test("X-2: a session moved back out of Starting Soon releases its waiting seats at the next heartbeat", async () => {
  const f = await fixture();
  const created = await group(f);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Moved away", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 4 });
  await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() });
  await f.service.editSession({ actorUserId: "host", groupId: created.id, sessionId: session.id, startsAt: inMinutes(f, 120) });
  f.advanceSeconds(10);
  assert.deepEqual(await f.service.heartbeat({ actorUserId: "m1", sessionId: session.id }), { seated: false, occupancy: 0, state: "scheduled" });
  assert.equal((await f.repository.read()).presences.find((row) => row.sessionId === session.id)?.leftAt, f.clock());
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() })), "session_not_open");
});

test("B6 / X-2: the file store's one-row renewal applies the same rule as the service", async () => {
  const f = await fixture();
  const created = await group(f, []);
  const nowMs = Date.parse(f.clock());
  const iso = (ms: number) => new Date(ms).toISOString();
  const cases = [
    { title: "soon", startsAt: iso(nowMs + 5 * 60_000), renews: true },
    { title: "later", startsAt: iso(nowMs + 2 * 60 * 60_000), renews: false },
    { title: "past", startsAt: iso(nowMs - 31 * 60_000), renews: false },
    { title: "late", startsAt: iso(nowMs - 29 * 60_000), renews: true }
  ];
  const ids: string[] = [];
  for (const item of cases) {
    const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: item.title, startsAt: iso(nowMs + 60 * 60_000), durationSeconds: 1800, maxParticipants: 4 });
    ids.push(session.id);
  }
  await f.repository.update((store) => {
    cases.forEach((item, index) => {
      const session = store.sessions.find((row) => row.id === ids[index]);
      if (session) session.startsAt = item.startsAt;
      store.presences.push({ id: `p-${index}`, sessionId: ids[index], userId: "host", requestedAt: iso(nowMs), enteredAt: iso(nowMs - 5_000), lastSeenAt: iso(nowMs - 5_000), leftAt: null, phase: "waiting" });
    });
  });
  for (const [index, item] of cases.entries()) {
    const renewed = await f.repository.renewSeat({ sessionId: ids[index], userId: "host", at: iso(nowMs), heldSince: iso(nowMs - 30_000), startsBy: iso(nowMs + 10 * 60_000) });
    assert.equal(renewed, item.renews, item.title);
  }
});

const reminders = (f: Fixture, userId: string) => f.notes.filter((item) => item.userId === userId && item.title === "Live Session reminder").map((item) => item.body);

test("N9-a: moving a reminded session later inside the window still reminds for the new time", async () => {
  const f = await fixture();
  const created = await group(f, ["m1"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Moved later", startsAt: inMinutes(f, 10), durationSeconds: 1800, maxParticipants: 4 });
  await f.service.planToAttend({ actorUserId: "m1", sessionId: session.id });
  f.advanceSeconds(60);
  await f.service.dispatchDueReminders();
  assert.deepEqual(reminders(f, "m1"), ['Moved later in the Study Group "Round two" starts in 9 minutes.']);

  // 10:03: the Host moves 10:10 to 10:11. The old reminder goes; the new time
  // is already inside its window, so its reminder goes out at once.
  f.advanceSeconds(120);
  await f.service.editSession({ actorUserId: "host", groupId: created.id, sessionId: session.id, startsAt: inMinutes(f, 8) });
  assert.deepEqual(reminders(f, "m1"), ['Moved later in the Study Group "Round two" starts in 8 minutes.']);
  assert.equal(reminders(f, "host").length, 1, "the Host is reminded for the new time too");
  await f.service.dispatchDueReminders();
  assert.equal(reminders(f, "m1").length, 1, "still one reminder per Start Time");
});

test("N9-b: a reminder for the new time sent just before the withdrawal is sent again", async () => {
  const f = await fixture();
  const created = await group(f, ["m1"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Raced move", startsAt: inMinutes(f, 30), durationSeconds: 1800, maxParticipants: 4 });
  await f.service.planToAttend({ actorUserId: "m1", sessionId: session.id });
  // The new time is saved; a dispatch tick lands before the withdrawal and
  // reminds for it, then the withdrawal deletes that reminder too.
  f.hooks.beforeWithdraw = async () => { await f.service.dispatchDueReminders(); };
  await f.service.editSession({ actorUserId: "host", groupId: created.id, sessionId: session.id, startsAt: inMinutes(f, 6) });
  f.hooks.beforeWithdraw = undefined;
  assert.deepEqual(reminders(f, "m1"), ['Raced move in the Study Group "Round two" starts in 6 minutes.']);
});

test("M10-a: a reminder names the group and the minutes really left, in both locales", async () => {
  const f = await fixture((base) => ({
    userProfile: async (userId) => ({ id: userId, displayName: userId, email: null, locale: userId === "m1" ? "zh-CN" : "en-GB" }),
    notify: async (input) => { base.notes.push(input); }
  }));
  const created = await group(f, ["m1"]);
  const soon = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Ninety seconds", startsAt: new Date(Date.parse(f.clock()) + 90_000).toISOString(), durationSeconds: 1800, maxParticipants: 4 });
  await f.service.planToAttend({ actorUserId: "m1", sessionId: soon.id });
  await f.service.dispatchDueReminders();
  assert.deepEqual(reminders(f, "host"), ['Ninety seconds in the Study Group "Round two" starts in 2 minutes.']);
  assert.deepEqual(f.notes.filter((item) => item.userId === "m1").map((item) => [item.title, item.body]), [["直播课提醒", "学习小组“Round two”的 Ninety seconds 将在 2 分钟后开始。"]]);

  const g = await fixture();
  const other = await group(g, []);
  await g.service.scheduleSession({ actorUserId: "host", groupId: other.id, title: "Half a minute", startsAt: new Date(Date.parse(g.clock()) + 30_000).toISOString(), durationSeconds: 1800, maxParticipants: 4 });
  await g.service.dispatchDueReminders();
  assert.deepEqual(reminders(g, "host"), ['Half a minute in the Study Group "Round two" starts in 1 minute.']);
});

test("M11-a: a failing reminder withdrawal never fails cancel, leave or cancel-attendance", async () => {
  const f = await fixture(() => ({ withdrawReminders: async () => { throw new Error("notification store down"); } }));
  const created = await group(f, ["m1", "m2"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Withdrawals", startsAt: inMinutes(f, 60), durationSeconds: 1800, maxParticipants: 4 });
  const other = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Cancelled one", startsAt: inMinutes(f, 90), durationSeconds: 1800, maxParticipants: 4 });
  await f.service.planToAttend({ actorUserId: "m1", sessionId: session.id });
  await f.service.cancelAttendance({ actorUserId: "m1", sessionId: session.id });
  await f.service.cancelSession({ actorUserId: "host", sessionId: other.id });
  await f.service.leaveGroup({ actorUserId: "m1", groupId: created.id });
  await f.service.editSession({ actorUserId: "host", groupId: created.id, sessionId: session.id, startsAt: inMinutes(f, 120) });
  await f.service.cancelGroup({ actorUserId: "host", groupId: created.id });
  // The cancel went through and the remaining member was still told.
  assert.equal((await f.repository.read()).groups.find((row) => row.id === created.id)?.status, "cancelled");
  assert.deepEqual(f.notes.filter((item) => item.title === "Study Group cancelled").map((item) => item.userId), ["m2"]);
});

async function liveSession(f: Fixture, title: string, seated: string[] = []) {
  const created = await group(f, ["m1", "m2"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title, startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 4 });
  await f.service.startSession({ actorUserId: "host", sessionId: session.id });
  for (const userId of seated) await f.service.enterSession({ actorUserId: userId, sessionId: session.id, requestedAt: f.clock() });
  return { group: created, session };
}

const stateOf = async (f: Fixture, sessionId: string) => (await f.repository.read()).sessions.find((row) => row.id === sessionId)?.status;

test("X-3: a room the provider still sees occupied is not ended when every heartbeat stops", async () => {
  const f = await fixture();
  const { session } = await liveSession(f, "Heartbeats down", ["m1"]);
  // The heartbeat endpoint is down for minutes while the call goes on.
  f.participants.list = ["host", "m1"];
  f.advanceSeconds(30 + 60 + 15);
  assert.deepEqual(await f.service.sweepPresence(), { seatsClosed: 2, sessionsEnded: 0 });
  assert.equal(await stateOf(f, session.id), "live");
  assert.deepEqual(f.providerReads, [session.id]);
  assert.deepEqual(f.logs, [{ type: "study_group.empty_live_kept", reason: "provider_participants", count: 1 }], "one redacted line: no room id, no identity");
  // Heartbeats come back: the members re-enter the same live session.
  assert.equal((await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() })).occupancy, 1);

  // Once the provider's room is empty too, the lease rule ends it as before.
  const g = await fixture();
  const other = (await liveSession(g, "Really gone", ["m1"])).session;
  const emptied = new Date(Date.parse(g.clock()) + 30_000).toISOString();
  g.participants.list = ["m1"];
  g.advanceSeconds(30 + 60 + 15);
  await g.service.sweepPresence();
  assert.equal(await stateOf(g, other.id), "live");
  g.participants.list = [];
  g.advanceSeconds(15);
  assert.deepEqual(await g.service.sweepPresence(), { seatsClosed: 0, sessionsEnded: 1 });
  const ended = (await g.repository.read()).sessions.find((row) => row.id === other.id);
  assert.equal(ended?.status, "completed");
  assert.equal(ended?.completedAt, emptied, "dated to when the seats emptied");
});

test("X-3: a provider that fails or does not answer in time falls back to the lease rule", async () => {
  for (const failure of [null, "hang"] as const) {
    const f = await fixture();
    const { session } = await liveSession(f, `Provider ${String(failure)}`);
    f.participants.list = failure;
    f.advanceSeconds(30 + 60 + 1);
    const started = Date.now();
    assert.deepEqual(await f.service.sweepPresence(), { seatsClosed: 1, sessionsEnded: 1 });
    assert.ok(Date.now() - started < 5_000, "a hanging provider read is cut off");
    assert.equal(await stateOf(f, session.id), "completed");
    assert.deepEqual(f.logs, []);
  }
});

test("X-3 / r3 server 2: one sweep asks about at most ten rooms, keeps the rest, and asks those first next time", async () => {
  const f = await fixture();
  const ids: string[] = [];
  for (let index = 0; index < 12; index += 1) ids.push((await liveSession(f, `Room ${index}`)).session.id);
  f.participants.list = ["host"];
  f.advanceSeconds(30 + 60 + 1);
  const states = async () => Promise.all(ids.map((id) => stateOf(f, id)));
  const result = await f.service.sweepPresence();
  assert.equal(f.providerReads.length, 10);
  assert.equal(result.sessionsEnded, 0, "a room nobody asked about is not ended under its participants");
  assert.deepEqual(await states(), ids.map(() => "live"));
  assert.deepEqual(f.logs, [
    { type: "study_group.empty_live_kept", reason: "provider_participants", count: 10 },
    { type: "study_group.empty_live_kept", reason: "check_deferred", count: 2 }
  ]);
  const unasked = ids.filter((id) => !f.providerReads.includes(id));
  assert.equal(unasked.length, 2);

  f.providerReads.length = 0;
  f.advanceSeconds(15);
  await f.service.sweepPresence();
  assert.ok(unasked.every((id) => f.providerReads.includes(id)), "the rooms left out last time are asked first");

  // The calls end: the provider's rooms are empty. Ten end now, the last two
  // at the next sweep.
  f.participants.list = [];
  f.advanceSeconds(15);
  assert.equal((await f.service.sweepPresence()).sessionsEnded, 10);
  f.advanceSeconds(15);
  assert.equal((await f.service.sweepPresence()).sessionsEnded, 2);
  assert.deepEqual(await states(), ids.map(() => "completed"));
});

test("X-4: a member still in the call takes the seat back from a newcomer who never connected", async () => {
  const f = await fixture();
  const created = await group(f, ["m1", "m2"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Two in the call", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 2 });
  await f.service.startSession({ actorUserId: "host", sessionId: session.id });
  await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() });
  // m1's heartbeats fail for 40 s while the call goes on; the Host renews.
  f.participants.list = ["host", "m1"];
  await heartbeats(f, session.id, ["host"], 40);
  // m2 takes the lapsed seat but the provider's room is full: never connects.
  assert.equal((await f.service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: f.clock() })).occupancy, 2);
  f.advanceSeconds(2);
  assert.equal((await f.service.heartbeat({ actorUserId: "m1", sessionId: session.id })).seated, false);
  // m1 re-enters: the provider still has m1 in the room, so m1 keeps the call.
  assert.equal((await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() })).occupancy, 2);
  assert.deepEqual(f.providerReads, [session.id], "the provider is read only for the full room");
  const store = await f.repository.read();
  assert.equal(store.presences.find((row) => row.sessionId === session.id && row.userId === "m2")?.leftAt, f.clock());
  assert.equal(store.presences.find((row) => row.sessionId === session.id && row.userId === "m1")?.leftAt, null);
  // m2 is told at the next heartbeat and finds the room full again.
  assert.equal((await f.service.heartbeat({ actorUserId: "m2", sessionId: session.id })).seated, false);
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: f.clock() })), "session_full");
});

test("X-4: without the provider's word, or for someone not in the room, a full room stays full", async () => {
  for (const provider of [null, ["host", "m2"]] as const) {
    const f = await fixture();
    const created = await group(f, ["m1", "m2"]);
    const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Full room", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 2 });
    await f.service.startSession({ actorUserId: "host", sessionId: session.id });
    await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() });
    await heartbeats(f, session.id, ["host"], 40);
    await f.service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: f.clock() });
    f.participants.list = provider ? [...provider] : null;
    assert.equal(await code(() => f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() })), "session_full");
    assert.equal((await f.repository.read()).presences.find((row) => row.sessionId === session.id && row.userId === "m2")?.leftAt, null);
  }
});

test("M7: Discover hides a group whose Course is gone, and the group says so instead of an empty name", async () => {
  const published = { value: true };
  const f = await fixture(() => ({
    courseSummary: async (courseId) => courseId === "course-1" && published.value ? { id: courseId, title: "German History", slug: "german-history" } : null
  }));
  const created = await group(f, ["m1"]);
  assert.equal((await f.service.listDiscover({ actorUserId: "m2" })).some((item) => item.id === created.id), true);
  assert.equal((await f.service.getGroup({ actorUserId: "m1", groupId: created.id })).courseAvailable, true);

  published.value = false;
  assert.equal((await f.service.listDiscover({ actorUserId: "m2" })).some((item) => item.id === created.id), false);
  assert.equal((await f.service.listDiscover({ actorUserId: null })).some((item) => item.id === created.id), false);
  const detail = await f.service.getGroup({ actorUserId: "m1", groupId: created.id });
  assert.deepEqual([detail.courseAvailable, detail.courseTitle, detail.courseSlug], [false, "", ""]);
  // Members keep the group in their own list, marked the same way.
  assert.equal((await f.service.listMine("m1")).find((item) => item.id === created.id)?.courseAvailable, false);

  const { readFile } = await import("node:fs/promises");
  const app = await readFile(path.join(process.cwd(), "components/portal/StudyGroupsApp.tsx"), "utf8");
  // The page's side (groupCourseLabel, joinGate) is tested by behaviour in
  // study-group-groups-page.test.ts (QA3 groups #3, #8).
  assert.match(app, /<p>\{groupCourseLabel\(selected, copy\.courseUnavailable\)\}<\/p>/);
  assert.match(app, /joinGate\(\{ signedIn, canJoin: selected\.canJoin, courseAvailable: selected\.courseAvailable \}\)/);
  for (const locale of ["en-GB", "zh-CN"]) {
    const messages = JSON.parse(await readFile(path.join(process.cwd(), `messages/${locale}.json`), "utf8")) as { studyGroupsPage: { courseUnavailable?: string } };
    assert.ok(messages.studyGroupsPage.courseUnavailable, `${locale} has the copy`);
  }
});

test("M17: leaving the Study Group removes the member from the group's live room, best effort", async () => {
  const f = await fixture();
  const { group: created, session } = await liveSession(f, "Leaving mid-call", ["m1"]);
  await f.service.leaveGroup({ actorUserId: "m1", groupId: created.id });
  assert.deepEqual(f.removed, [{ room: session.id, identity: "m1" }]);
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).occupancy, 1);

  // A provider failure never fails the leave itself.
  const g = await fixture((base) => ({
    liveKitGateway: {
      ensureRoom: async () => undefined,
      issueParticipantToken: async () => ({ token: "stub-token", expiresAt: START, url: "wss://livekit.example.test" }),
      publishTutorMessage: async () => undefined,
      removeParticipant: async (input) => { base.removed.push({ room: input.room, identity: input.identity }); throw new Error("provider down"); },
      healthCheck: async ({ project }) => ({ projectId: project.id, status: "healthy", evidence: "provider_api", providerVerified: true, checkedAt: START, latencyMs: 0 })
    }
  }));
  const other = await liveSession(g, "Provider down", ["m2"]);
  await g.service.leaveGroup({ actorUserId: "m2", groupId: other.group.id });
  assert.deepEqual(g.removed, [{ room: other.session.id, identity: "m2" }]);
  assert.equal((await g.service.listMine("m2")).some((item) => item.id === other.group.id), false);
});

test("M12: rate limiting and network failures answer livekit_temporarily_unavailable (503), never \"not configured\"", async () => {
  const { LiveKitGatewayError } = await import("../../modules/group-study/liveKitGateway");
  const { studyGroupFailure } = await import("../../modules/group-study/http");
  for (const [failure, expected] of [["rate_limited", "livekit_temporarily_unavailable"], ["unreachable", "livekit_temporarily_unavailable"], ["unverified", "unavailable"]] as const) {
    const f = await fixture((base) => ({
      liveKitGateway: {
        ensureRoom: async () => { throw new LiveKitGatewayError(failure); },
        issueParticipantToken: async () => ({ token: "stub-token", expiresAt: START, url: "wss://livekit.example.test" }),
        recoverParticipantToken: async () => { throw new LiveKitGatewayError(failure); },
        publishTutorMessage: async () => undefined,
        removeParticipant: async (input) => { base.removed.push(input); },
        healthCheck: async ({ project }) => ({ projectId: project.id, status: "healthy", evidence: "provider_api", providerVerified: true, checkedAt: START, latencyMs: 0 })
      }
    }));
    const created = await group(f, []);
    const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: `Provider ${failure}`, startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 4 });
    assert.equal(await code(() => f.service.startSession({ actorUserId: "host", sessionId: session.id })), expected, `start on ${failure}`);
    // The token path maps the same way.
    await f.repository.update((store) => {
      const row = store.sessions.find((item) => item.id === session.id);
      if (row) Object.assign(row, { status: "live", startedAt: f.clock(), liveKitProjectId: "eu-primary" });
    });
    await f.service.enterSession({ actorUserId: "host", sessionId: session.id, requestedAt: f.clock() });
    assert.equal(await code(() => f.service.issueToken({ actorUserId: "host", sessionId: session.id, recovery: true })), expected, `token on ${failure}`);
  }
  const { StudyGroupError } = await import("../../modules/group-study/domain");
  const response = studyGroupFailure(new StudyGroupError("livekit_temporarily_unavailable", "LiveKit is temporarily unavailable. Try again."));
  assert.equal(response.status, 503);
  const { readFile } = await import("node:fs/promises");
  const en = JSON.parse(await readFile(path.join(process.cwd(), "messages/en-GB.json"), "utf8")) as { studyGroupsPage: { errors: Record<string, string> } };
  const zh = JSON.parse(await readFile(path.join(process.cwd(), "messages/zh-CN.json"), "utf8")) as { studyGroupsPage: { errors: Record<string, string> } };
  assert.equal(en.studyGroupsPage.errors.livekit_temporarily_unavailable, "The Live Session connection is temporarily unavailable. Try again in a moment.");
  assert.equal(zh.studyGroupsPage.errors.livekit_temporarily_unavailable, "直播课连接暂时不可用，请稍后重试。");
});

async function tutorRoom(f: Fixture, asker = "m1") {
  const created = await group(f, ["m1", "m2"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Tutor room", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 4, aiTutorEnabled: true });
  await f.service.startSession({ actorUserId: "host", sessionId: session.id });
  await f.service.enterSession({ actorUserId: asker, sessionId: session.id, requestedAt: f.clock() });
  return session;
}

type Published = { text: string; mode: string; messageId: string; replyTo?: { name: string; question: string } };

test("M21: a drain stops claiming after its budget and hands the rest of the queue to a fresh drain", async () => {
  const published: Published[] = [];
  const retries: Array<() => void> = [];
  // Each model call takes 40 s of the service clock; the budget is 30 s.
  const f = await fixture((base) => ({
    tutorDrainBudgetMs: 30_000,
    scheduleRetry: (run) => { retries.push(run); },
    publishRoomChat: async (input) => { published.push(input); },
    tutorKeys: () => [{ id: "k", secret: "fake-key" }],
    tutorCall: async ({ text }) => { base.advanceSeconds(40); return { outcome: "ok", latencyMs: 40_000, body: `Answer: ${text}` }; }
  }));
  const session = await tutorRoom(f);
  for (const n of [1, 2]) await f.service.enqueueTutor({ actorUserId: "m1", sessionId: session.id, text: `Question ${n}`, clientEventId: `evt-${n}` });
  await f.service.deliverTutorAnswer({ sessionId: session.id });
  assert.deepEqual(published.map((item) => item.text), ["Answer: Question 1"], "the first answer is out; the second waits for the next drain");
  assert.equal(retries.length, 1, "the drain scheduled its own continuation");
  retries[0]();
  // A drain asked for meanwhile waits for the continuation, then finds nothing left.
  await f.service.deliverTutorAnswer({ sessionId: session.id });
  assert.deepEqual(published.map((item) => item.text), ["Answer: Question 1", "Answer: Question 2"]);
});

test("M21: a drain waits for a running one only so long, and the running one answers what was queued meanwhile", async () => {
  const published: Published[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const f = await fixture(() => ({
    tutorDrainWaitMs: 50,
    publishRoomChat: async (input) => { published.push(input); },
    tutorKeys: () => [{ id: "k", secret: "fake-key" }],
    tutorCall: async ({ text }) => { await gate; return { outcome: "ok", latencyMs: 1, body: `Answer: ${text}` }; }
  }));
  const session = await tutorRoom(f);
  await f.service.enqueueTutor({ actorUserId: "m1", sessionId: session.id, text: "First", clientEventId: "evt-first" });
  const running = f.service.deliverTutorAnswer({ sessionId: session.id });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await f.service.enqueueTutor({ actorUserId: "m1", sessionId: session.id, text: "Second", clientEventId: "evt-second" });
  assert.equal(await f.service.deliverTutorAnswer({ sessionId: session.id }), null, "the second drain gives up instead of waiting for ever");
  release();
  await running;
  assert.deepEqual(published.map((item) => item.text), ["Answer: First", "Answer: Second"]);
});

test("r3-ops / r3-B3: a failing profile, knowledge read or model call answers instead of stranding the question", async () => {
  const published: Published[] = [];
  const profileDown = { value: false };
  const f = await fixture(() => ({
    userProfile: async (userId) => {
      if (userId === "m1" && profileDown.value) throw new Error("profile store down");
      return { id: userId, displayName: userId === "m2" ? "" : userId, email: null, locale: "en-GB" };
    },
    courseKnowledge: async () => { throw new Error("knowledge unreadable"); },
    publishRoomChat: async (input) => { published.push(input); },
    tutorKeys: () => [{ id: "k", secret: "fake-key" }],
    tutorCall: async ({ text, context }) => {
      if (text.includes("explode")) throw new Error("socket hang up");
      return { outcome: "ok", latencyMs: 1, body: `COURSE\nAnswer (${context ? "with" : "without"} material): ${text}` };
    }
  }));
  const session = await tutorRoom(f);
  await f.service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: f.clock() });
  await f.service.enqueueTutor({ actorUserId: "m1", sessionId: session.id, text: "Why 1933?", clientEventId: "evt-a" });
  await f.service.enqueueTutor({ actorUserId: "m2", sessionId: session.id, text: "Please explode", clientEventId: "evt-b" });
  profileDown.value = true;
  await f.service.deliverTutorAnswer({ sessionId: session.id });
  profileDown.value = false;
  assert.deepEqual(published.map((item) => [item.text, item.mode, item.replyTo?.name]), [
    ["Answer (without material): Why 1933?", "general", ""],
    ["", "unavailable", ""]
  ]);
  const store = await f.repository.read();
  assert.deepEqual(store.tutorRequests.map((row) => row.status), ["answered", "answered"], "nothing is left in flight");

  // The runtime gives a learner without a nickname an empty name, so the
  // answer says "a participant" rather than an id (r3-B3).
  const { studyGroupProfile } = await import("../../modules/group-study/runtime");
  assert.equal(studyGroupProfile({ id: "usr_123", nickname: "", email: null, locale: "en-GB" }).displayName, "");
  assert.equal(studyGroupProfile({ id: "usr_123", nickname: "Anna", email: null, locale: "zh-CN" }).displayName, "Anna");
  assert.equal((await f.service.getSession({ actorUserId: "m2", sessionId: session.id })).attendees.find((item) => item.userId === "m2")?.displayName, "m2", "the roster keeps its own stand-in");
});

test("M21: an answer whose publish dies queues one unavailable notice for the same message", async () => {
  const published: Published[] = [];
  const f = await fixture(() => ({
    scheduleRetry: () => undefined,
    publishRoomChat: async (input) => {
      if (input.mode !== "unavailable") throw new Error("publish failed");
      published.push(input);
    },
    tutorKeys: () => [{ id: "k", secret: "fake-key" }],
    tutorCall: async ({ text }) => ({ outcome: "ok", latencyMs: 1, body: `Answer: ${text}` })
  }));
  const session = await tutorRoom(f);
  const asked = await f.service.enqueueTutor({ actorUserId: "m1", sessionId: session.id, text: "Lost answer", clientEventId: "evt-lost" });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await f.repository.update((store) => { for (const row of store.outbox) row.nextAttemptAt = null; });
    await f.service.deliverTutorAnswer({ sessionId: session.id });
  }
  assert.deepEqual(published.map((item) => [item.messageId, item.text, item.mode]), [[asked.id, "", "unavailable"]]);
  const outbox = (await f.repository.read()).outbox;
  assert.deepEqual(outbox.map((row) => [row.dedupeKey, row.status]), [[asked.id, "dead"], [`${asked.id}:unavailable`, "delivered"]]);
});

test("M21: a question whose every attempt died is dead-lettered with an unavailable message while the room is live", async () => {
  const published: Published[] = [];
  const f = await fixture(() => ({ publishRoomChat: async (input) => { published.push(input); } }));
  const session = await tutorRoom(f);
  const asked = await f.service.enqueueTutor({ actorUserId: "m1", sessionId: session.id, text: "Crashing question", clientEventId: "evt-crash" });
  // Five processes died holding it: the lease ran out with attempts used up.
  await f.repository.update((store) => {
    const row = store.tutorRequests.find((item) => item.id === asked.id);
    if (row) Object.assign(row, { status: "in_flight", inFlight: true, attempts: 5, leaseOwner: "dead-process", leaseExpiresAt: new Date(Date.now() - 1_000).toISOString() });
  });
  await f.service.deliverTutorAnswer({ sessionId: session.id });
  const row = (await f.repository.read()).tutorRequests.find((item) => item.id === asked.id);
  assert.deepEqual([row?.status, row?.terminalReason], ["dead_letter", "attempts_exhausted"]);
  assert.deepEqual(published.map((item) => [item.messageId, item.text, item.mode]), [[asked.id, "", "unavailable"]]);
});

test("r3-ops: a failed background tutor delivery leaves one redacted log line", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(path.join(process.cwd(), "modules/group-study/tutorHttp.ts"), "utf8");
  assert.match(source, /\.catch\(\(\) => \{ console\.info\(JSON\.stringify\(\{ type: "study_group\.tutor_delivery_failed" \}\)\); \}\)/);
});

test("X-5: asking the AI Tutor after the seat lapsed answers seat_lapsed (409), not a bare forbidden", async () => {
  const f = await fixture();
  const session = await tutorRoom(f);
  f.advanceSeconds(31);
  const ask = (n: number) => f.service.enqueueTutor({ actorUserId: "m1", sessionId: session.id, text: `Still there ${n}?`, clientEventId: `evt-lapsed-${n}` });
  assert.equal(await code(() => ask(1)), "seat_lapsed");
  // Also once the sweep has written the lapse down.
  await f.service.sweepPresence();
  assert.equal(await code(() => ask(2)), "seat_lapsed");
  // After re-entry the question goes through.
  await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() });
  assert.equal(await code(() => ask(3)), "ok");
  // Someone who never entered, or who left, is still simply not in the room.
  assert.equal(await code(() => f.service.enqueueTutor({ actorUserId: "m2", sessionId: session.id, text: "Hello?", clientEventId: "evt-never" })), "forbidden");
  await f.service.leaveSession({ actorUserId: "m1", sessionId: session.id });
  assert.equal(await code(() => ask(4)), "forbidden");

  const { studyGroupFailure } = await import("../../modules/group-study/http");
  const { StudyGroupError } = await import("../../modules/group-study/domain");
  assert.equal(studyGroupFailure(new StudyGroupError("seat_lapsed", "lapsed")).status, 409);
  const { readFile } = await import("node:fs/promises");
  for (const locale of ["en-GB", "zh-CN"]) {
    const messages = JSON.parse(await readFile(path.join(process.cwd(), `messages/${locale}.json`), "utf8")) as { studyGroupsPage: { errors: Record<string, string> } };
    assert.ok(messages.studyGroupsPage.errors.seat_lapsed, `${locale} has the copy`);
  }
});

// QA round three, server review of round two (r3 server 1-7) and the server
// half of the groups-page review (r3 groups 2, 3).

test("r3 X-4: a non-member or a member who never held the seat costs no provider read", async () => {
  const f = await fixture();
  const created = await group(f, ["m1", "m2"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Full room", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 2 });
  await f.service.startSession({ actorUserId: "host", sessionId: session.id });
  await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() });
  f.participants.list = ["host", "m1"];
  // m3 owns the Course but never joined the group.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(await code(() => f.service.enterSession({ actorUserId: "m3", sessionId: session.id, requestedAt: f.clock() })), "forbidden");
  }
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: f.clock() })), "session_full");
  assert.deepEqual(f.providerReads, []);
});

test("r3 X-4: a slow provider read never holds up anyone else's entry", async () => {
  const f = await fixture();
  const created = await group(f, ["m1", "m2", "m3"]);
  const full = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Full room", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 2 });
  await f.service.startSession({ actorUserId: "host", sessionId: full.id });
  await f.service.enterSession({ actorUserId: "m1", sessionId: full.id, requestedAt: f.clock() });
  await heartbeats(f, full.id, ["host"], 40);
  await f.service.enterSession({ actorUserId: "m2", sessionId: full.id, requestedAt: f.clock() });
  const other = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Other room", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 4 });
  // m1's seat lapsed: the room check runs, and the provider never answers.
  f.participants.list = "hang";
  let lapsedDone = false;
  const lapsed = code(() => f.service.enterSession({ actorUserId: "m1", sessionId: full.id, requestedAt: f.clock() })).finally(() => { lapsedDone = true; });
  for (let tries = 0; tries < 50 && f.providerReads.length === 0; tries += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(f.providerReads.length, 1, "the provider is being asked");
  const started = Date.now();
  assert.equal((await f.service.enterSession({ actorUserId: "m3", sessionId: other.id, requestedAt: f.clock() })).occupancy, 1);
  assert.ok(Date.now() - started < 1_000, "another entry is not queued behind the provider read");
  assert.equal(lapsedDone, false);
  assert.equal(await lapsed, "session_full", "no answer from the provider: the room stays full");
});

test("r3 X-4: re-entries of one room share one provider read for a few seconds", async () => {
  const f = await fixture();
  const created = await group(f, ["m1", "m2"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Shared read", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 2 });
  await f.service.startSession({ actorUserId: "host", sessionId: session.id });
  await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() });
  await heartbeats(f, session.id, ["host"], 40);
  await f.service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: f.clock() });
  f.participants.list = ["host", "m2"];
  const enter = () => code(() => f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() }));
  assert.deepEqual(await Promise.all([enter(), enter(), enter()]), ["session_full", "session_full", "session_full"]);
  assert.equal(f.providerReads.length, 1, "concurrent re-entries share one read");
  f.advanceSeconds(2);
  assert.equal(await enter(), "session_full");
  assert.equal(f.providerReads.length, 1, "and reuse it briefly");
  f.advanceSeconds(2);
  f.participants.list = ["host", "m1"];
  assert.equal(await enter(), "ok", "a fresh read once the shared one is old");
  assert.equal(f.providerReads.length, 2);
});

test("r3 X-4: a seat taken after the provider read is never given away on that read", async () => {
  const f = await fixture();
  f.access.add("m4:course-1");
  const created = await group(f, ["m1", "m2", "m3", "m4"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Read age", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 3 });
  await f.service.startSession({ actorUserId: "host", sessionId: session.id });
  for (const userId of ["m1", "m2"]) await f.service.enterSession({ actorUserId: userId, sessionId: session.id, requestedAt: f.clock() });
  await heartbeats(f, session.id, ["host"], 40);
  await f.service.enterSession({ actorUserId: "m3", sessionId: session.id, requestedAt: f.clock() });
  f.advanceSeconds(1);
  await f.service.enterSession({ actorUserId: "m4", sessionId: session.id, requestedAt: f.clock() });
  // m1 and m2 lapsed but are in the call; m4, the newest holder, never connected.
  f.participants.list = ["host", "m1", "m2"];
  f.advanceSeconds(1);
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() })), "ok");
  // A second later m3 leaves and m4 takes that seat again, after the read.
  f.advanceSeconds(1);
  await f.service.leaveSession({ actorUserId: "m3", sessionId: session.id });
  await f.service.enterSession({ actorUserId: "m4", sessionId: session.id, requestedAt: f.clock() });
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: f.clock() })), "session_full");
  assert.equal(f.providerReads.length, 1);
  assert.equal((await f.repository.read()).presences.find((row) => row.sessionId === session.id && row.userId === "m4")?.leftAt, null);
});

test("r3 server 3: only the group's members keep a room alive, and anyone else still in it is removed", async () => {
  for (const provider of [["m1"], ["host", "m1"]]) {
    const f = await fixture();
    const { group: created, session } = await liveSession(f, `Strays ${provider.join(" ")}`, ["m1"]);
    await f.service.leaveGroup({ actorUserId: "m1", groupId: created.id });
    f.removed.length = 0;
    // m1 reconnects with a token that has not expired yet.
    f.participants.list = [...provider];
    f.advanceSeconds(30 + 60 + 15);
    const kept = provider.includes("host");
    assert.deepEqual(await f.service.sweepPresence(), { seatsClosed: 1, sessionsEnded: kept ? 0 : 1 });
    assert.equal(await stateOf(f, session.id), kept ? "live" : "completed");
    assert.deepEqual(f.removed, [{ room: session.id, identity: "m1" }]);
  }
});

test("r3 server 4: seatsOpen is 0 while nobody can enter: before Starting Soon and past the planned end", async () => {
  const f = await fixture();
  const created = await group(f, ["m1", "m2"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Later", startsAt: inMinutes(f, 30), durationSeconds: 1800, maxParticipants: 4 });
  const view = () => f.service.getSession({ actorUserId: "m2", sessionId: session.id });
  assert.deepEqual([(await view()).state, (await view()).seatsOpen], ["scheduled", 0]);
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: f.clock() })), "session_not_open");
  f.advanceSeconds(25 * 60);
  assert.deepEqual([(await view()).state, (await view()).seatsOpen], ["starting_soon", 3]);
  // Never started: past the planned end the waiting room is closed.
  f.advanceSeconds(36 * 60);
  assert.deepEqual([(await view()).state, (await view()).seatsOpen], ["starting_soon", 0]);
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m2", sessionId: session.id, requestedAt: f.clock() })), "session_not_open");
});

test("r3 groups 2: the session view tells a seated viewer they hold a seat, so a full session is still theirs", async () => {
  const f = await fixture();
  const created = await group(f, ["m1", "m2"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Two seats", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 2 });
  const view = (userId: string) => f.service.getSession({ actorUserId: userId, sessionId: session.id });
  assert.equal((await view("m1")).viewerSeated, false);
  await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() });
  // A reload of the groups page: no seat left for a member, yet m1 holds one.
  assert.deepEqual([(await view("m1")).seatsOpen, (await view("m1")).viewerSeated], [0, true]);
  assert.deepEqual([(await view("m2")).seatsOpen, (await view("m2")).viewerSeated], [0, false]);
  assert.equal((await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() })).occupancy, 1, "entering again renews the same seat");
  const listed = (await f.service.getGroup({ actorUserId: "m1", groupId: created.id })).sessions?.find((item) => item.id === session.id);
  assert.equal(listed?.viewerSeated, true, "the group's session list carries it too");
  // Once the lease runs out, the seat is no longer the viewer's.
  f.advanceSeconds(31);
  assert.equal((await view("m1")).viewerSeated, false);
});

test("r3 groups 3: a group whose Course is gone cannot be joined", async () => {
  const published = { value: true };
  const f = await fixture(() => ({
    courseSummary: async (courseId) => courseId === "course-1" && published.value ? { id: courseId, title: "German History", slug: "german-history" } : null
  }));
  const created = await group(f, ["m1"]);
  assert.equal((await f.service.getGroup({ actorUserId: "m2", groupId: created.id })).canJoin, true);
  published.value = false;
  const gate = await f.service.getGroup({ actorUserId: "m2", groupId: created.id });
  assert.deepEqual([gate.courseAvailable, gate.canJoin], [false, false]);
  assert.equal(await code(() => f.service.joinGroup({ actorUserId: "m2", groupId: created.id })), "course_unavailable");
  assert.equal((await f.repository.read()).memberships.some((row) => row.groupId === created.id && row.userId === "m2"), false);
  // A member already in stays in; joining again still answers.
  assert.equal((await f.service.joinGroup({ actorUserId: "m1", groupId: created.id })).memberCount, 2);

  const { studyGroupFailure } = await import("../../modules/group-study/http");
  const { StudyGroupError } = await import("../../modules/group-study/domain");
  assert.equal(studyGroupFailure(new StudyGroupError("course_unavailable", "gone")).status, 409);
  const { readFile } = await import("node:fs/promises");
  for (const locale of ["en-GB", "zh-CN"]) {
    const messages = JSON.parse(await readFile(path.join(process.cwd(), `messages/${locale}.json`), "utf8")) as { studyGroupsPage: { errors: Record<string, string> } };
    assert.ok(messages.studyGroupsPage.errors.course_unavailable, `${locale} has the copy`);
  }
});

test("r3 server 5: one question's keys share one deadline, so it settles inside its claim lease", async () => {
  const published: Published[] = [];
  const calls: Array<{ secret: string; timeoutMs?: number }> = [];
  const f = await fixture(() => ({
    tutorAnswerBudgetMs: 60,
    publishRoomChat: async (input) => { published.push(input); },
    tutorKeys: () => [{ id: "a", secret: "key-a" }, { id: "b", secret: "key-b" }],
    tutorCall: async ({ secret, timeoutMs }) => {
      calls.push({ secret, timeoutMs });
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { outcome: "failed", latencyMs: 80 };
    }
  }));
  const session = await tutorRoom(f);
  const asked = await f.service.enqueueTutor({ actorUserId: "m1", sessionId: session.id, text: "Slow provider?", clientEventId: "evt-slow" });
  await f.service.deliverTutorAnswer({ sessionId: session.id });
  assert.deepEqual(calls.map((item) => item.secret), ["key-a"], "no second key once the deadline has passed");
  assert.ok(calls[0].timeoutMs !== undefined && calls[0].timeoutMs > 0 && calls[0].timeoutMs <= 60, "the call gets only the time left");
  assert.deepEqual(published.map((item) => [item.messageId, item.mode]), [[asked.id, "unavailable"]]);

  // A key that fails fast leaves time for the next one.
  const g = await fixture(() => ({
    tutorAnswerBudgetMs: 5_000,
    publishRoomChat: async (input) => { published.push(input); },
    tutorKeys: () => [{ id: "a", secret: "key-a" }, { id: "b", secret: "key-b" }],
    tutorCall: async ({ secret, text }) => secret === "key-a" ? { outcome: "rate_limited", latencyMs: 1 } : { outcome: "ok", latencyMs: 1, body: `Answer: ${text}` }
  }));
  const room = await tutorRoom(g);
  await g.service.enqueueTutor({ actorUserId: "m1", sessionId: room.id, text: "Fast failover", clientEventId: "evt-fast" });
  await g.service.deliverTutorAnswer({ sessionId: room.id });
  assert.equal(published.at(-1)?.text, "Answer: Fast failover");
});

test("r3 server 7a: a dispatch that lands between the move and the withdrawal reminds once, by mail too", async () => {
  const f = await fixture();
  const created = await group(f, ["m1"]);
  const mailsTo = (userId: string) => f.mails.filter((item) => item.to === `${userId}@example.test` && item.text.includes(" starts in ")).map((item) => item.text);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Raced mail", startsAt: inMinutes(f, 30), durationSeconds: 1800, maxParticipants: 4 });
  await f.service.planToAttend({ actorUserId: "m1", sessionId: session.id });
  // The move into the window is saved; the timer's dispatch lands before
  // the reschedule's own withdrawal and dispatch.
  f.hooks.beforeWithdraw = async () => { await f.service.dispatchDueReminders(); };
  await f.service.editSession({ actorUserId: "host", groupId: created.id, sessionId: session.id, startsAt: inMinutes(f, 6) });
  f.hooks.beforeWithdraw = undefined;
  assert.deepEqual(mailsTo("m1"), ['Raced mail in the Study Group "Round two" starts in 6 minutes.'], "one mail for the new time, not two");
  assert.deepEqual(reminders(f, "m1"), ['Raced mail in the Study Group "Round two" starts in 6 minutes.']);

  // Moved again inside the window: the earlier time's reminder goes, the
  // reminder for the new time comes once.
  f.advanceSeconds(60);
  f.hooks.beforeWithdraw = async () => { await f.service.dispatchDueReminders(); };
  await f.service.editSession({ actorUserId: "host", groupId: created.id, sessionId: session.id, startsAt: inMinutes(f, 8) });
  f.hooks.beforeWithdraw = undefined;
  assert.deepEqual(mailsTo("m1"), [
    'Raced mail in the Study Group "Round two" starts in 6 minutes.',
    'Raced mail in the Study Group "Round two" starts in 8 minutes.'
  ]);
  assert.deepEqual(reminders(f, "m1"), ['Raced mail in the Study Group "Round two" starts in 8 minutes.']);
});

test("r3 server 7a: a dispatch whose rows were claimed before a move sends nothing for the old time", async () => {
  let moveDuringSend: (() => Promise<void>) | undefined;
  const f = await fixture(() => ({
    userProfile: async (userId) => {
      // The move's write commits after the dispatch claimed its rows and
      // before it sends.
      const move = moveDuringSend;
      moveDuringSend = undefined;
      await move?.();
      return { id: userId, displayName: userId, email: `${userId}@example.test`, locale: "en-GB" };
    }
  }));
  const created = await group(f, ["m1"]);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Claimed early", startsAt: inMinutes(f, 30), durationSeconds: 1800, maxParticipants: 4 });
  await f.service.planToAttend({ actorUserId: "m1", sessionId: session.id });
  f.advanceSeconds(22 * 60);
  moveDuringSend = async () => {
    await f.repository.update((store) => {
      const row = store.sessions.find((item) => item.id === session.id)!;
      row.startsAt = inMinutes(f, 60);
    });
  };
  await f.service.dispatchDueReminders();
  assert.deepEqual(f.mails.filter((item) => item.text.includes(" starts in ")), [], "no mail for the old time");
  assert.deepEqual(f.notes.filter((item) => item.title === "Live Session reminder"), [], "no reminder for the old time");
});

test("r3 server 7b: a reschedule sends only that session's reminders", async () => {
  const f = await fixture();
  const created = await group(f, ["m1"]);
  const other = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Left to the timer", startsAt: inMinutes(f, 8), durationSeconds: 1800, maxParticipants: 4 });
  const moved = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Moved in", startsAt: inMinutes(f, 60), durationSeconds: 1800, maxParticipants: 4 });
  await f.service.editSession({ actorUserId: "host", groupId: created.id, sessionId: moved.id, startsAt: inMinutes(f, 7) });
  assert.deepEqual(f.notes.filter((item) => item.title === "Live Session reminder").map((item) => item.sessionId), [moved.id]);
  await f.service.dispatchDueReminders();
  assert.deepEqual(f.notes.filter((item) => item.title === "Live Session reminder").map((item) => item.sessionId), [moved.id, other.id]);
});

test("r3 server 7c: entering a session moved back out of Starting Soon releases the seat, as documented", async () => {
  const f = await fixture();
  const created = await group(f);
  const session = await f.service.scheduleSession({ actorUserId: "host", groupId: created.id, title: "Moved away", startsAt: inMinutes(f, 5), durationSeconds: 1800, maxParticipants: 4 });
  await f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() });
  await f.service.editSession({ actorUserId: "host", groupId: created.id, sessionId: session.id, startsAt: inMinutes(f, 120) });
  f.advanceSeconds(5);
  assert.equal(await code(() => f.service.enterSession({ actorUserId: "m1", sessionId: session.id, requestedAt: f.clock() })), "session_not_open");
  assert.equal((await f.repository.read()).presences.find((row) => row.sessionId === session.id)?.leftAt, f.clock(), "released now, not left to lapse");
  assert.equal((await f.service.getSession({ actorUserId: "m1", sessionId: session.id })).occupancy, 0);
});
