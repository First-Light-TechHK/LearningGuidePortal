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
  notes: Array<{ userId: string; title: string; body: string; sessionId?: string }>;
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
    notify: async (input) => { notes.push(input); },
    listReminders: async () => [],
    // The stored reminder notifications, withdrawn like productStore does.
    withdrawReminders: async (input) => {
      await hooks.beforeWithdraw?.();
      for (let index = notes.length - 1; index >= 0; index -= 1) {
        const note = notes[index];
        if (note.title === "Live Session reminder" && note.sessionId && input.sessionIds.includes(note.sessionId) && (!input.userId || note.userId === input.userId)) notes.splice(index, 1);
      }
    },
    sendMail: async () => undefined,
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
  assert.match(app, /disabled=\{session\.seatsOpen <= 0\}/);
  assert.match(app, /\{session\.seatsOpen <= 0 \? copy\.sessionFull : copy\.joinNow\}/);
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

test("X-3: one sweep asks the provider about at most ten rooms", async () => {
  const f = await fixture();
  const ids: string[] = [];
  for (let index = 0; index < 12; index += 1) ids.push((await liveSession(f, `Room ${index}`)).session.id);
  f.participants.list = ["host"];
  f.advanceSeconds(30 + 60 + 1);
  const result = await f.service.sweepPresence();
  assert.equal(f.providerReads.length, 10);
  assert.equal(result.sessionsEnded, 2, "rooms beyond the bound follow the lease rule");
  const states = await Promise.all(ids.map((id) => stateOf(f, id)));
  assert.equal(states.filter((state) => state === "live").length, 10);
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
  assert.match(app, /<p>\{selected\.courseAvailable === false \? copy\.courseUnavailable : selected\.courseTitle\}<\/p>/);
  assert.match(app, /selected\.courseAvailable === false \? copy\.courseUnavailable : fill\(copy\.courseAccessRequired/);
  assert.match(app, /selected\.courseAvailable === false && signedIn \? null : <a className=\{styles\.primary\} href=\{signedIn \? `\/\$\{locale\}\/portal\/courses\/\$\{selected\.courseSlug\}`/);
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
  const f = await fixture(() => ({
    tutorDrainBudgetMs: 30,
    scheduleRetry: (run) => { retries.push(run); },
    publishRoomChat: async (input) => { published.push(input); },
    tutorKeys: () => [{ id: "k", secret: "fake-key" }],
    tutorCall: async ({ text }) => { await new Promise((resolve) => setTimeout(resolve, 40)); return { outcome: "ok", latencyMs: 40, body: `Answer: ${text}` }; }
  }));
  const session = await tutorRoom(f);
  for (const n of [1, 2]) await f.service.enqueueTutor({ actorUserId: "m1", sessionId: session.id, text: `Question ${n}`, clientEventId: `evt-${n}` });
  await f.service.deliverTutorAnswer({ sessionId: session.id });
  assert.deepEqual(published.map((item) => item.text), ["Answer: Question 1"], "the first answer is out; the second waits for the next drain");
  assert.equal(retries.length, 1, "the drain scheduled its own continuation");
  retries[0]();
  for (let tries = 0; tries < 100 && published.length < 2; tries += 1) await new Promise((resolve) => setTimeout(resolve, 20));
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
