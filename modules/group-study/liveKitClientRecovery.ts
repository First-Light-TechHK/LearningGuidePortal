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
