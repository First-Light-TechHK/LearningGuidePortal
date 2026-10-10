import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveKitCloudGateway, type LiveKitRoomService } from "../../modules/group-study/liveKitCloudGateway";
import type { LiveKitProjectRef } from "../../modules/group-study/liveKitProjectRegistry";

const project: LiveKitProjectRef = {
  id: "eu-primary",
  url: "wss://eu-primary.livekit.cloud",
  state: "active",
  weight: 1,
  credentialSecretId: "learning-guide/livekit/eu-primary"
};

test("Cloud gateway creates a bounded room and issues a scoped participant token without exposing the secret", async () => {
  const created: Array<{ room: string; maxParticipants: number }> = [];
  const gateway = createLiveKitCloudGateway({
    resolveCredentials: async () => ({ apiKey: "api-key", apiSecret: "secret-not-in-token" }),
    createRoomService: async (_project, _credentials): Promise<LiveKitRoomService> => ({
      createRoom: async (input) => { created.push(input); },
      sendData: async () => undefined,
      removeParticipant: async () => undefined,
      listRooms: async () => []
    }),
    now: () => new Date("2026-10-10T12:00:00.000Z")
  });

  await gateway.ensureRoom({ project, room: "session-1", maxParticipants: 6 });
  const issued = await gateway.issueParticipantToken({ project, room: "session-1", identity: "learner-1", name: "Learner", ttlSeconds: 600 });

  assert.deepEqual(created, [{ room: "session-1", maxParticipants: 6 }]);
  assert.equal(issued.url, project.url);
  assert.equal(issued.expiresAt, "2026-10-10T12:10:00.000Z");
  assert.equal(issued.token.includes("secret-not-in-token"), false);
  const payload = JSON.parse(Buffer.from(issued.token.split(".")[1], "base64url").toString("utf8")) as { sub: string; video: { room: string; roomJoin: boolean; canPublish: boolean; canSubscribe: boolean; canPublishData: boolean } };
  assert.deepEqual(payload.video, { room: "session-1", roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  assert.equal(payload.sub, "learner-1");
});

test("Cloud gateway publishes a shared reliable tutor packet with a stable message id", async () => {
  const sent: Array<{ room: string; data: Uint8Array; kind: string; options: { destinationIdentities?: string[] } }> = [];
  const gateway = createLiveKitCloudGateway({
    resolveCredentials: async () => ({ apiKey: "api-key", apiSecret: "secret" }),
    createRoomService: async (): Promise<LiveKitRoomService> => ({
      createRoom: async () => undefined,
      sendData: async (room, data, kind, options) => { sent.push({ room, data, kind, options }); },
      removeParticipant: async () => undefined,
      listRooms: async () => []
    })
  });

  await gateway.publishTutorMessage({ project, room: "session-1", messageId: "tutor-request-1", text: "Grounded answer" });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].room, "session-1");
  assert.equal(sent[0].kind, "RELIABLE");
  assert.equal(sent[0].options.destinationIdentities, undefined);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(sent[0].data)), { type: "tutor", id: "tutor-request-1", text: "Grounded answer" });
});

test("Cloud gateway uses a non-mutating room listing as a redacted permission health check", async () => {
  let credentialReads = 0;
  const gateway = createLiveKitCloudGateway({
    resolveCredentials: async () => {
      credentialReads += 1;
      return { apiKey: "api-key", apiSecret: "never-return-this" };
    },
    createRoomService: async (): Promise<LiveKitRoomService> => ({
      createRoom: async () => undefined,
      sendData: async () => undefined,
      removeParticipant: async () => undefined,
      listRooms: async () => [{ name: "one" }, { name: "two" }]
    }),
    now: () => new Date("2026-10-10T12:00:00.000Z")
  });

  const health = await gateway.healthCheck({ project });

  assert.deepEqual(health, { projectId: "eu-primary", status: "healthy", evidence: "provider_api", checkedAt: "2026-10-10T12:00:00.000Z", latencyMs: 0, activeRooms: 2 });
  assert.equal(credentialReads, 1);
  assert.equal(JSON.stringify(health).includes("never-return-this"), false);
});

test("Cloud gateway classifies credential retrieval and provider authorization failures without returning provider errors", async () => {
  const missingCredentialGateway = createLiveKitCloudGateway({
    resolveCredentials: async () => { throw new Error("secret reference learning-guide/livekit/private is missing"); },
    now: () => new Date("2026-10-10T12:00:00.000Z")
  });
  const unauthorizedGateway = createLiveKitCloudGateway({
    resolveCredentials: async () => ({ apiKey: "api-key", apiSecret: "api-secret" }),
    createRoomService: async (): Promise<LiveKitRoomService> => ({
      createRoom: async () => undefined,
      sendData: async () => undefined,
      removeParticipant: async () => undefined,
      listRooms: async () => { throw { status: 403, message: "private provider detail" }; }
    }),
    now: () => new Date("2026-10-10T12:00:00.000Z")
  });

  const missing = await missingCredentialGateway.healthCheck({ project });
  const unauthorized = await unauthorizedGateway.healthCheck({ project });

  assert.equal(missing.status, "credential_unavailable");
  assert.equal(missing.evidence, "credential_resolution");
  assert.equal(unauthorized.status, "unauthorized");
  assert.equal(unauthorized.evidence, "provider_error");
  assert.equal(JSON.stringify({ missing, unauthorized }).includes("private"), false);
});
