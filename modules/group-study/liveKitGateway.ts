import type { LiveKitProjectRef } from "./liveKitProjectRegistry";

export type LiveKitCredentials = Readonly<{ apiKey: string; apiSecret: string }>;

export type LiveKitParticipantToken = Readonly<{ token: string; expiresAt: string; url: string }>;

export type LiveKitGatewayFailureCode = "credential_unavailable" | "unauthorized" | "rate_limited" | "unreachable" | "unverified";

export class LiveKitGatewayError extends Error {
  readonly code: LiveKitGatewayFailureCode;

  constructor(code: LiveKitGatewayFailureCode) {
    super("LiveKit is temporarily unavailable.");
    this.name = "LiveKitGatewayError";
    this.code = code;
  }
}

export type LiveKitTutorMessage = Readonly<{ project: LiveKitProjectRef; room: string; messageId: string; text: string; mode: string }>;

export type LiveKitWebhookEvent = Readonly<{
  eventId: string;
  eventType: string;
  room: string | null;
  participantIdentity: string | null;
  // The participant's connection-level id (livekit.ParticipantInfo.sid), one
  // per connection. Audit F-5: the service matches a participant_left against
  // the seat's recorded connection so a zombie connection's late event cannot
  // close a seat a re-entry has re-established. Optional so fixtures written
  // before the field existed keep compiling; its absence reads as "connection
  // unknown" and the timestamp guard decides.
  participantSid?: string | null;
  createdAt: string | null;
  projectId: string;
}>;

export type LiveKitProjectHealthStatus = "healthy" | "unverified" | "credential_unavailable" | "unauthorized" | "rate_limited" | "unreachable";
export type LiveKitProjectHealthEvidence = "provider_api" | "simulated" | "credential_resolution" | "provider_error";

export type LiveKitProjectHealth = Readonly<{
  projectId: string;
  status: LiveKitProjectHealthStatus;
  evidence: LiveKitProjectHealthEvidence;
  providerVerified: boolean;
  checkedAt: string;
  latencyMs: number;
  activeRooms?: number;
}>;

export interface LiveKitRoomGateway {
  ensureRoom(input: { project: LiveKitProjectRef; room: string; maxParticipants: number }): Promise<void>;
  issueParticipantToken(input: { project: LiveKitProjectRef; room: string; identity: string; name: string; ttlSeconds: number }): Promise<LiveKitParticipantToken>;
  recoverParticipantToken?(input: { project: LiveKitProjectRef; room: string; identity: string; name: string; ttlSeconds: number }): Promise<LiveKitParticipantToken>;
  verifyWebhook?(input: { rawBody: string; authHeader: string | null }): Promise<LiveKitWebhookEvent>;
  // Provider read used by reconciliation sweep B (slice-2 design §4). Absence
  // means the capability is unavailable: sweep B is skipped, never guessed.
  listParticipants?(input: { project: LiveKitProjectRef; room: string }): Promise<ReadonlyArray<{ identity: string }>>;
  publishTutorMessage(input: LiveKitTutorMessage): Promise<void>;
  removeParticipant(input: { project: LiveKitProjectRef; room: string; identity: string }): Promise<void>;
  healthCheck(input: { project: LiveKitProjectRef; forceRefresh?: boolean }): Promise<LiveKitProjectHealth>;
}
