import { AccessToken, DataPacket_Kind, RoomServiceClient, WebhookReceiver, type WebhookEvent } from "livekit-server-sdk";
import { LiveKitGatewayError, type LiveKitCredentials, type LiveKitProjectHealthStatus, type LiveKitRoomGateway, type LiveKitWebhookEvent } from "./liveKitGateway";
import type { LiveKitProjectRef, LiveKitProjectRegistry } from "./liveKitProjectRegistry";

export type LiveKitRoomService = {
  createRoom(input: { room: string; maxParticipants: number }): Promise<void>;
  sendData(room: string, data: Uint8Array, kind: "RELIABLE", options: { destinationIdentities?: string[] }): Promise<void>;
  removeParticipant(room: string, identity: string): Promise<void>;
  // Optional so transports that only create/remove (fakes, legacy fixtures)
  // keep working; the cloud gateway treats a missing reader as unreachable.
  listParticipants?(room: string): Promise<ReadonlyArray<{ identity: string }>>;
  listRooms(): Promise<ReadonlyArray<unknown>>;
};

type CloudGatewayDeps = {
  resolveCredentials: (project: LiveKitProjectRef, options?: { forceRefresh?: boolean }) => Promise<LiveKitCredentials>;
  createRoomService?: (project: LiveKitProjectRef, credentials: LiveKitCredentials) => Promise<LiveKitRoomService>;
  registry?: LiveKitProjectRegistry;
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
    async listParticipants(room) {
      const participants = await client.listParticipants(room);
      // Only the identity crosses this boundary; a provider entry without one
      // is skipped rather than guessed.
      return participants
        .map((participant) => participant.identity)
        .filter((identity): identity is string => typeof identity === "string" && identity.length > 0)
        .map((identity) => ({ identity }));
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
  if (error instanceof LiveKitGatewayError) return error;
  const status = healthFailure(error);
  if (status === "unauthorized" || status === "rate_limited") return new LiveKitGatewayError(status);
  return new LiveKitGatewayError("unreachable");
}

// The `iss` claim is read without trusting it: it only chooses which project's
// secret will be used for the real cryptographic validation.
function jwtIssuer(authHeader: string): string | null {
  const parts = authHeader.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { iss?: unknown };
    return typeof payload.iss === "string" && payload.iss.trim() ? payload.iss : null;
  } catch {
    return null;
  }
}

// Webhook createdAt is unix SECONDS (proto int64, bigint at runtime; the
// protocol documents it as "timestamp in seconds"). It used to be read as
// microseconds, which put every event in January 1970: participant_left then
// never closed a seat because every seat looked newer than the event.
function createdAtIso(value: unknown): string | null {
  const seconds = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

export function createLiveKitCloudGateway(deps: CloudGatewayDeps): LiveKitRoomGateway {
  const now = deps.now ?? (() => new Date());
  const providerVerified = deps.providerVerified !== false;
  const roomService = async (project: LiveKitProjectRef, options?: { forceRefresh?: boolean }) => {
    const credentials = await deps.resolveCredentials(project, options);
    return deps.createRoomService ? deps.createRoomService(project, credentials) : defaultRoomService(project, credentials);
  };
  let webhookRefreshAt = -Infinity;

  // A provider call with the project's current key pair. A rotation inside
  // the credential cache window shows up as a 401/403 from the provider: the
  // secret is then re-read at once and, if it now holds another pair, the
  // call is made once more with it. Every call here is safe to repeat (create
  // and remove are idempotent, a refused send delivered nothing).
  async function withRoomService<T>(project: LiveKitProjectRef, run: (service: LiveKitRoomService) => Promise<T>): Promise<T> {
    let credentials: LiveKitCredentials;
    let service: LiveKitRoomService;
    try {
      credentials = await deps.resolveCredentials(project);
      service = deps.createRoomService ? await deps.createRoomService(project, credentials) : defaultRoomService(project, credentials);
    } catch {
      throw new LiveKitGatewayError("credential_unavailable");
    }
    try {
      return await run(service);
    } catch (error) {
      if (healthFailure(error) !== "unauthorized") throw recoveryFailure(error);
    }
    let current: LiveKitCredentials;
    try {
      current = await deps.resolveCredentials(project, { forceRefresh: true });
      if (current.apiKey === credentials.apiKey && current.apiSecret === credentials.apiSecret) throw new LiveKitGatewayError("unauthorized");
      service = deps.createRoomService ? await deps.createRoomService(project, current) : defaultRoomService(project, current);
    } catch (error) {
      throw error instanceof LiveKitGatewayError ? error : new LiveKitGatewayError("credential_unavailable");
    }
    try {
      return await run(service);
    } catch (error) {
      throw recoveryFailure(error);
    }
  }
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

  async function verifyWebhook({ rawBody, authHeader }: { rawBody: string; authHeader: string | null }): Promise<LiveKitWebhookEvent> {
    // Every rejection is the same typed `unverified`: no issuer, key id, or
    // payload detail may leave this boundary.
    if (!deps.registry || !providerVerified || !rawBody) throw new LiveKitGatewayError("unverified");
    const issuer = authHeader ? jwtIssuer(authHeader) : null;
    if (!issuer) throw new LiveKitGatewayError("unverified");
    const registry = deps.registry;
    await registry.refresh?.();
    const issuerProject = async (forceRefresh: boolean) => {
      for (const project of registry.all()) {
        try {
          const credentials = await deps.resolveCredentials(project, forceRefresh ? { forceRefresh: true } : undefined);
          if (credentials.apiKey === issuer) return { project, credentials };
        } catch {
          // An unreadable project secret cannot be the signer; try the next.
        }
      }
      return null;
    };
    // An issuer no cached key matches may be a key rotated in within the
    // cache window: the secrets are re-read at once, at most every 10 s,
    // because anyone can send this request with any issuer.
    let match = await issuerProject(false);
    if (!match && now().getTime() - webhookRefreshAt >= 10_000) {
      webhookRefreshAt = now().getTime();
      match = await issuerProject(true);
    }
    if (match) {
      const { project, credentials } = match;
      let event: WebhookEvent;
      try {
        event = await new WebhookReceiver(credentials.apiKey, credentials.apiSecret).receive(rawBody, authHeader ?? undefined);
      } catch {
        throw new LiveKitGatewayError("unverified");
      }
      const eventId = event.id.trim();
      const eventType = event.event.trim();
      if (!eventId || !eventType) throw new LiveKitGatewayError("unverified");
      return {
        eventId,
        eventType,
        room: event.room?.name.trim() ? event.room.name : null,
        participantIdentity: event.participant?.identity.trim() ? event.participant.identity : null,
        // The connection-level id (audit F-5), read from the same participant
        // object as the identity; a participant_* event always carries both.
        participantSid: event.participant?.sid?.trim() ? event.participant.sid : null,
        createdAt: createdAtIso(event.createdAt),
        projectId: project.id
      };
    }
    throw new LiveKitGatewayError("unverified");
  }

  async function listParticipants({ project, room }: { project: LiveKitProjectRef; room: string }): Promise<ReadonlyArray<{ identity: string }>> {
    return withRoomService(project, async (service) => {
      // A transport without the capability must fail typed here: reading a
      // missing list as "nobody is present" would close live seats.
      if (!service.listParticipants) throw new LiveKitGatewayError("unreachable");
      return service.listParticipants(room);
    });
  }

  async function participantToken(credentials: LiveKitCredentials, input: { project: LiveKitProjectRef; room: string; identity: string; name: string; ttlSeconds: number }) {    const token = new AccessToken(credentials.apiKey, credentials.apiSecret, { identity: input.identity, name: input.name, ttl: input.ttlSeconds });
    token.addGrant({ room: input.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    return {
      token: await token.toJwt(),
      expiresAt: new Date(now().getTime() + input.ttlSeconds * 1_000).toISOString(),
      url: input.project.url
    };
  }

  return {
    async ensureRoom({ project, room, maxParticipants }) {
      await withRoomService(project, (service) => service.createRoom({ room, maxParticipants }));
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
    async publishTutorMessage({ project, room, messageId, text, mode, replyTo, reason }) {
      const payload = new TextEncoder().encode(JSON.stringify({ type: "tutor", id: messageId, text, mode, ...(replyTo ? { replyTo } : {}), ...(reason ? { reason } : {}) }));
      await withRoomService(project, (service) => service.sendData(room, payload, "RELIABLE", {}));
    },
    async removeParticipant({ project, room, identity }) {
      await withRoomService(project, (service) => service.removeParticipant(room, identity));
    },
    verifyWebhook,
    // Participant listing is a provider-verified capability: the DEV fake
    // gateway (providerVerified: false) intentionally has no such member, and
    // reconciliation reads the absence as "capability unavailable" and skips
    // sweep B rather than treating it as an empty room.
    ...(providerVerified ? { listParticipants } : {}),
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
