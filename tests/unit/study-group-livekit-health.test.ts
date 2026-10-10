import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveKitHealthService } from "../../modules/group-study/liveKitHealth";
import { parseLiveKitProjects } from "../../modules/group-study/liveKitProjectRegistry";
import type { LiveKitRoomGateway } from "../../modules/group-study/liveKitGateway";

const registry = parseLiveKitProjects(JSON.stringify([
  { id: "active", url: "wss://active.livekit.cloud", state: "active", credentialSecretId: "active-secret" },
  { id: "draining", url: "wss://draining.livekit.cloud", state: "draining", credentialSecretId: "draining-secret" },
  { id: "disabled", url: "wss://disabled.livekit.cloud", state: "disabled", credentialSecretId: "disabled-secret" }
]));

function gateway(check: LiveKitRoomGateway["healthCheck"]): LiveKitRoomGateway {
  return {
    ensureRoom: async () => undefined,
    issueParticipantToken: async () => ({ token: "token", expiresAt: "2026-10-10T12:10:00.000Z", url: "wss://active.livekit.cloud" }),
    publishTutorMessage: async () => undefined,
    removeParticipant: async () => undefined,
    healthCheck: check
  };
}

test("LiveKit health checks active and draining projects, skips disabled projects, and caches the snapshot", async () => {
  const checked: string[] = [];
  const health = createLiveKitHealthService({
    registry,
    gateway: gateway(async ({ project }) => {
      checked.push(project.id);
      return { projectId: project.id, status: project.id === "draining" ? "unreachable" : "healthy", checkedAt: "2026-10-10T12:00:00.000Z", latencyMs: 4, activeRooms: 3 };
    }),
    now: () => new Date("2026-10-10T12:00:00.000Z"),
    cacheTtlMs: 60_000
  });

  const first = await health.check();
  const second = await health.check();

  assert.deepEqual(checked, ["active", "draining"]);
  assert.equal(first.ready, true);
  assert.equal(first.attentionRequired, true);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes("active-secret"), false);
  assert.equal(JSON.stringify(first).includes("disabled-secret"), false);
});

test("LiveKit health reports new-session readiness false when an active project cannot be reached", async () => {
  const health = createLiveKitHealthService({
    registry,
    gateway: gateway(async ({ project }) => ({ projectId: project.id, status: project.id === "active" ? "unauthorized" : "healthy", checkedAt: "2026-10-10T12:00:00.000Z", latencyMs: 2 })),
    now: () => new Date("2026-10-10T12:00:00.000Z")
  });

  const snapshot = await health.check();
  assert.equal(snapshot.ready, false);
  assert.equal(snapshot.attentionRequired, true);
  assert.equal(snapshot.projects.find((item) => item.id === "active")?.status, "unauthorized");
});
