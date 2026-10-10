import { AccessToken, DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import { LiveKitGatewayError, type LiveKitCredentials, type LiveKitProjectHealthStatus, type LiveKitRoomGateway } from "./liveKitGateway";
import type { LiveKitProjectRef } from "./liveKitProjectRegistry";

export type LiveKitRoomService = {
  createRoom(input: { room: string; maxParticipants: number }): Promise<void>;
  sendData(room: string, data: Uint8Array, kind: "RELIABLE", options: { destinationIdentities?: string[] }): Promise<void>;
  removeParticipant(room: string, identity: string): Promise<void>;
  listRooms(): Promise<ReadonlyArray<unknown>>;
};

type CloudGatewayDeps = {
  resolveCredentials: (project: LiveKitProjectRef, options?: { forceRefresh?: boolean }) => Promise<LiveKitCredentials>;
  createRoomService?: (project: LiveKitProjectRef, credentials: LiveKitCredentials) => Promise<LiveKitRoomService>;
  providerVerified?: boolean;
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

function recoveryFailure(error: unknown) {
  const status = healthFailure(error);
  if (status === "unauthorized" || status === "rate_limited") return new LiveKitGatewayError(status);
  return new LiveKitGatewayError("unreachable");
}

export function createLiveKitCloudGateway(deps: CloudGatewayDeps): LiveKitRoomGateway {
  const now = deps.now ?? (() => new Date());
  const providerVerified = deps.providerVerified !== false;
  const roomService = async (project: LiveKitProjectRef, options?: { forceRefresh?: boolean }) => {
    const credentials = await deps.resolveCredentials(project, options);
    return deps.createRoomService ? deps.createRoomService(project, credentials) : defaultRoomService(project, credentials);
  };
  const recoveryVerifications = new Map<string, Promise<LiveKitCredentials>>();

  async function verifiedCurrentCredentials(project: LiveKitProjectRef) {
    const existing = recoveryVerifications.get(project.id);
    if (existing) return existing;
    const operation = (async () => {
      let credentials: LiveKitCredentials;
      let service: LiveKitRoomService;
      try {
        credentials = await deps.resolveCredentials(project, { forceRefresh: true });
        service = deps.createRoomService ? await deps.createRoomService(project, credentials) : defaultRoomService(project, credentials);
      } catch {
        throw new LiveKitGatewayError("credential_unavailable");
      }
      if (!providerVerified) throw new LiveKitGatewayError("unverified");
      try {
        await service.listRooms();
      } catch (error) {
        throw recoveryFailure(error);
      }
      return credentials;
    })().finally(() => { recoveryVerifications.delete(project.id); });
    recoveryVerifications.set(project.id, operation);
    return operation;
  }

  async function participantToken(credentials: LiveKitCredentials, input: { project: LiveKitProjectRef; room: string; identity: string; name: string; ttlSeconds: number }) {
    const token = new AccessToken(credentials.apiKey, credentials.apiSecret, { identity: input.identity, name: input.name, ttl: input.ttlSeconds });
    token.addGrant({ room: input.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    return {
      token: await token.toJwt(),
      expiresAt: new Date(now().getTime() + input.ttlSeconds * 1_000).toISOString(),
      url: input.project.url
    };
  }

  return {
    async ensureRoom({ project, room, maxParticipants }) {
      let service: LiveKitRoomService;
      try {
        service = await roomService(project);
      } catch {
        throw new LiveKitGatewayError("credential_unavailable");
      }
      try {
        await service.createRoom({ room, maxParticipants });
      } catch (error) {
        throw recoveryFailure(error);
      }
    },
    async issueParticipantToken({ project, room, identity, name, ttlSeconds }) {
      let credentials: LiveKitCredentials;
      try {
        credentials = await deps.resolveCredentials(project);
      } catch {
        throw new LiveKitGatewayError("credential_unavailable");
      }
      return participantToken(credentials, { project, room, identity, name, ttlSeconds });
    },
    async recoverParticipantToken({ project, room, identity, name, ttlSeconds }) {
      const credentials = await verifiedCurrentCredentials(project);
      return participantToken(credentials, { project, room, identity, name, ttlSeconds });
    },
    async publishTutorMessage({ project, room, messageId, text }) {
      const payload = new TextEncoder().encode(JSON.stringify({ type: "tutor", id: messageId, text }));
      let service: LiveKitRoomService;
      try {
        service = await roomService(project);
      } catch {
        throw new LiveKitGatewayError("credential_unavailable");
      }
      try {
        await service.sendData(room, payload, "RELIABLE", {});
      } catch (error) {
        throw recoveryFailure(error);
      }
    },
    async removeParticipant({ project, room, identity }) {
      let service: LiveKitRoomService;
      try {
        service = await roomService(project);
      } catch {
        throw new LiveKitGatewayError("credential_unavailable");
      }
      try {
        await service.removeParticipant(room, identity);
      } catch (error) {
        throw recoveryFailure(error);
      }
    },
    async healthCheck({ project, forceRefresh }) {
      const startedAt = now().getTime();
      let service: LiveKitRoomService;
      try {
        service = await roomService(project, forceRefresh ? { forceRefresh: true } : undefined);
      } catch {
        return { projectId: project.id, status: "credential_unavailable", evidence: "credential_resolution", providerVerified: false, checkedAt: now().toISOString(), latencyMs: Math.max(0, now().getTime() - startedAt) };
      }
      try {
        const rooms = await service.listRooms();
        if (!providerVerified) return { projectId: project.id, status: "unverified", evidence: "simulated", providerVerified: false, checkedAt: now().toISOString(), latencyMs: Math.max(0, now().getTime() - startedAt) };
        return { projectId: project.id, status: "healthy", evidence: "provider_api", providerVerified: true, checkedAt: now().toISOString(), latencyMs: Math.max(0, now().getTime() - startedAt), activeRooms: rooms.length };
      } catch (error) {
        return { projectId: project.id, status: healthFailure(error), evidence: "provider_error", providerVerified: false, checkedAt: now().toISOString(), latencyMs: Math.max(0, now().getTime() - startedAt) };
      }
    }
  };
}
