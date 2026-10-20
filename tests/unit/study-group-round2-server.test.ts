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
  /** The provider's room membership (listParticipants); null makes the read fail. */
  participants: { list: string[] | null };
  removed: Array<{ room: string; identity: string }>;
  notes: Array<{ userId: string; title: string; body: string; sessionId?: string }>;
  logs: Array<Record<string, unknown>>;
};

async function fixture(extra: (base: Omit<Fixture, "service">) => Partial<StudyGroupDeps> = () => ({})): Promise<Fixture> {
  const directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-r2-"));
  directories.push(directory);
  const repository = createStudyGroupRepository(directory);
  let nowMs = Date.parse(START);
  const access = new Set(["host:course-1", "m1:course-1", "m2:course-1", "m3:course-1"]);
  const participants: { list: string[] | null } = { list: [] };
  const removed: Array<{ room: string; identity: string }> = [];
  const notes: Fixture["notes"] = [];
  const logs: Fixture["logs"] = [];
  const gateway: LiveKitRoomGateway = {
    ensureRoom: async () => undefined,
    issueParticipantToken: async () => ({ token: "stub-token", expiresAt: START, url: "wss://livekit.example.test" }),
    publishTutorMessage: async () => undefined,
    removeParticipant: async (input) => { removed.push({ room: input.room, identity: input.identity }); },
    healthCheck: async ({ project }) => ({ projectId: project.id, status: "healthy", evidence: "provider_api", providerVerified: true, checkedAt: START, latencyMs: 0 }),
    listParticipants: async () => {
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
    removed,
    notes,
    logs
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
    sendMail: async () => undefined,
    liveKit: { apiKey: "lk-key", apiSecret: "lk-secret-at-least-32-characters", url: "wss://livekit.example.test" },
    liveKitProjects: parseLiveKitProjects(PROJECTS_JSON),
    liveKitGateway: gateway,
    tokenLogKey: () => tokenLogKey,
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
