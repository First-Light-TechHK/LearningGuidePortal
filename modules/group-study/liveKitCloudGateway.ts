import { AccessToken, DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import type { LiveKitCredentials, LiveKitProjectHealthStatus, LiveKitRoomGateway } from "./liveKitGateway";
import type { LiveKitProjectRef } from "./liveKitProjectRegistry";

export type LiveKitRoomService = {
  createRoom(input: { room: string; maxParticipants: number }): Promise<void>;
  sendData(room: string, data: Uint8Array, kind: "RELIABLE", options: { destinationIdentities?: string[] }): Promise<void>;
  removeParticipant(room: string, identity: string): Promise<void>;
  listRooms(): Promise<ReadonlyArray<unknown>>;
};

type CloudGatewayDeps = {
  resolveCredentials: (project: LiveKitProjectRef) => Promise<LiveKitCredentials>;
  createRoomService?: (project: LiveKitProjectRef, credentials: LiveKitCredentials) => Promise<LiveKitRoomService>;
  now?: () => Date;
};

function serviceUrl(url: string) {
  return url.replace(/^wss:/i, "https:");
}

function defaultRoomService(project: LiveKitProjectRef, credentials: LiveKitCredentials): LiveKitRoomService {
  const client = new RoomServiceClient(serviceUrl(project.url), credentials.apiKey, credentials.apiSecret);
  return {
    async createRoom({ room, maxParticipants }) {
      await client.createRoom({ name: room, maxParticipants });
    },
    async sendData(room, data, kind, options) {
      await client.sendData(room, data, DataPacket_Kind.RELIABLE, options);
      void kind;
    },
    async removeParticipant(room, identity) {
      await client.removeParticipant(room, identity);
    },
    async listRooms() {
      return client.listRooms();
    }
  };
}

function httpStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  for (const candidate of [value.status, value.statusCode, value.code]) {
    if (typeof candidate === "number") return candidate;
    if (typeof candidate === "string" && /^\d{3}$/.test(candidate)) return Number(candidate);
  }
  return undefined;
}

function healthFailure(error: unknown): LiveKitProjectHealthStatus {
  const status = httpStatus(error);
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  return "unreachable";
}

export function createLiveKitCloudGateway(deps: CloudGatewayDeps): LiveKitRoomGateway {
  const now = deps.now ?? (() => new Date());
  const roomService = async (project: LiveKitProjectRef) => {
    const credentials = await deps.resolveCredentials(project);
    return deps.createRoomService ? deps.createRoomService(project, credentials) : defaultRoomService(project, credentials);
  };

  return {
    async ensureRoom({ project, room, maxParticipants }) {
      await (await roomService(project)).createRoom({ room, maxParticipants });
    },
    async issueParticipantToken({ project, room, identity, name, ttlSeconds }) {
      const credentials = await deps.resolveCredentials(project);
      const token = new AccessToken(credentials.apiKey, credentials.apiSecret, { identity, name, ttl: ttlSeconds });
      token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
      return {
        token: await token.toJwt(),
        expiresAt: new Date(now().getTime() + ttlSeconds * 1_000).toISOString(),
        url: project.url
      };
    },
    async publishTutorMessage({ project, room, messageId, text }) {
      const payload = new TextEncoder().encode(JSON.stringify({ type: "tutor", id: messageId, text }));
      await (await roomService(project)).sendData(room, payload, "RELIABLE", {});
    },
    async removeParticipant({ project, room, identity }) {
      await (await roomService(project)).removeParticipant(room, identity);
    },
    async healthCheck({ project }) {
      const startedAt = now().getTime();
      let service: LiveKitRoomService;
      try {
        service = await roomService(project);
      } catch {
        return { projectId: project.id, status: "credential_unavailable", checkedAt: now().toISOString(), latencyMs: Math.max(0, now().getTime() - startedAt) };
      }
      try {
        const rooms = await service.listRooms();
        return { projectId: project.id, status: "healthy", checkedAt: now().toISOString(), latencyMs: Math.max(0, now().getTime() - startedAt), activeRooms: rooms.length };
      } catch (error) {
        return { projectId: project.id, status: healthFailure(error), checkedAt: now().toISOString(), latencyMs: Math.max(0, now().getTime() - startedAt) };
      }
    }
  };
}
