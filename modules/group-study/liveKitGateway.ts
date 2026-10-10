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

export type LiveKitTutorMessage = Readonly<{ project: LiveKitProjectRef; room: string; messageId: string; text: string }>;

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
  publishTutorMessage(input: LiveKitTutorMessage): Promise<void>;
  removeParticipant(input: { project: LiveKitProjectRef; room: string; identity: string }): Promise<void>;
  healthCheck(input: { project: LiveKitProjectRef; forceRefresh?: boolean }): Promise<LiveKitProjectHealth>;
}
