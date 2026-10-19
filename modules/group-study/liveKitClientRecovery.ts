import { classifyLiveKitIncident, type LiveKitIncident } from "./liveKitIncident";

export type LiveKitClientEvent =
  | { type: "disconnect"; reason?: string; recoveryUsed: boolean }
  | { type: "connection_quality"; quality: string }
  | { type: "reconnected" };

export type LiveKitClientTransition = Readonly<{
  type: "recover_token" | "sdk_reconnecting" | "terminal" | "unavailable" | "connected" | "ignore";
  incident: LiveKitIncident | null;
}>;

// The browser may observe the same fault through multiple SDK callbacks. This
// policy is pure so every callback order has a repeatable, bounded outcome.
export function transitionLiveKitClient(event: LiveKitClientEvent): LiveKitClientTransition {
  if (event.type === "reconnected") return { type: "connected", incident: null };
  if (event.type === "connection_quality") {
    const incident = classifyLiveKitIncident({ source: "connection_quality", quality: event.quality });
    return incident ? { type: "sdk_reconnecting", incident } : { type: "ignore", incident: null };
  }
  const incident = classifyLiveKitIncident({ source: "disconnect", reason: event.reason });
  if (incident.action === "reissue_verified_token" && !event.recoveryUsed) return { type: "recover_token", incident };
  if (incident.terminal) return { type: "terminal", incident };
  return { type: "unavailable", incident };
}

// livekit-client reports a disconnect reason as the protocol's NUMERIC enum
// (DisconnectReason.DUPLICATE_IDENTITY === 2), while the classifier matches
// reason NAMES. String(reason) turned every disconnect into "2", "7", ... so
// none was ever recognised (QA 2026-10-19 N2). The caller passes the SDK's
// enum object; a reason that is already a name passes through.
export function liveKitDisconnectReasonName(reason: unknown, names: Record<number, string>): string | undefined {
  if (typeof reason === "number") return names[reason];
  if (typeof reason === "string" && reason) return reason;
  return undefined;
}
