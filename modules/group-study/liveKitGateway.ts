import type { LiveKitProjectRef } from "./liveKitProjectRegistry";

export type LiveKitCredentials = Readonly<{ apiKey: string; apiSecret: string }>;

export type LiveKitParticipantToken = Readonly<{ token: string; expiresAt: string; url: string }>;

export type LiveKitTutorMessage = Readonly<{ project: LiveKitProjectRef; room: string; messageId: string; text: string }>;

export type LiveKitProjectHealthStatus = "healthy" | "credential_unavailable" | "unauthorized" | "rate_limited" | "unreachable";

export type LiveKitProjectHealth = Readonly<{
  projectId: string;
  status: LiveKitProjectHealthStatus;
  checkedAt: string;
  latencyMs: number;
  activeRooms?: number;
}>;

export interface LiveKitRoomGateway {
  ensureRoom(input: { project: LiveKitProjectRef; room: string; maxParticipants: number }): Promise<void>;
  issueParticipantToken(input: { project: LiveKitProjectRef; room: string; identity: string; name: string; ttlSeconds: number }): Promise<LiveKitParticipantToken>;
  publishTutorMessage(input: LiveKitTutorMessage): Promise<void>;
  removeParticipant(input: { project: LiveKitProjectRef; room: string; identity: string }): Promise<void>;
  healthCheck(input: { project: LiveKitProjectRef }): Promise<LiveKitProjectHealth>;
}
