export type LiveKitIncidentCode =
  | "join_failed"
  | "room_ended"
  | "duplicate_identity"
  | "participant_removed"
  | "network_lost"
  | "provider_credentials_invalid"
  | "provider_rate_limited"
  | "provider_unreachable"
  | "provider_unverified";

export type LiveKitIncidentAction =
  | "reissue_verified_token"
  | "end_session"
  | "show_duplicate_identity"
  | "show_removed"
  | "sdk_reconnect"
  | "try_standby_for_new_room"
  | "show_unavailable";

export type LiveKitIncident = Readonly<{
  code: LiveKitIncidentCode;
  severity: "info" | "warning" | "error";
  action: LiveKitIncidentAction;
  terminal: boolean;
}>;

export type LiveKitIncidentInput =
  | { source: "disconnect"; reason?: string }
  | { source: "connection_quality"; quality: string }
  | { source: "gateway"; code: "credential_unavailable" | "unauthorized" | "rate_limited" | "unreachable" | "unverified"; phase: "new_room" | "existing_room" };

const clientReportableCodes = new Set<LiveKitIncidentCode>([
  "join_failed",
  "room_ended",
  "duplicate_identity",
  "participant_removed",
  "network_lost"
]);

export function isClientReportableLiveKitIncidentCode(value: unknown): value is LiveKitIncidentCode {
  return typeof value === "string" && clientReportableCodes.has(value as LiveKitIncidentCode);
}

function providerIncident(code: LiveKitIncidentInput & { source: "gateway" }): LiveKitIncident {
  if (code.code === "credential_unavailable" || code.code === "unauthorized") {
    return { code: "provider_credentials_invalid", severity: "error", action: "show_unavailable", terminal: false };
  }
  if (code.code === "rate_limited") {
    return {
      code: "provider_rate_limited",
      severity: "warning",
      action: code.phase === "new_room" ? "try_standby_for_new_room" : "show_unavailable",
      terminal: false
    };
  }
  if (code.code === "unverified") return { code: "provider_unverified", severity: "error", action: "show_unavailable", terminal: false };
  return { code: "provider_unreachable", severity: "warning", action: "show_unavailable", terminal: false };
}

// This is the single classification seam for browser, server, and telemetry.
// Callers receive an action, never provider detail, credentials, or raw errors.
export function classifyLiveKitIncident(input: Extract<LiveKitIncidentInput, { source: "disconnect" } | { source: "gateway" }>): LiveKitIncident;
export function classifyLiveKitIncident(input: Extract<LiveKitIncidentInput, { source: "connection_quality" }>): LiveKitIncident | null;
export function classifyLiveKitIncident(input: LiveKitIncidentInput): LiveKitIncident | null {
  if (input.source === "gateway") return providerIncident(input);
  if (input.source === "connection_quality") {
    if (input.quality.toUpperCase() === "LOST") return { code: "network_lost", severity: "warning", action: "sdk_reconnect", terminal: false };
    return null;
  }
  switch (input.reason?.toUpperCase()) {
    case "JOIN_FAILURE": return { code: "join_failed", severity: "error", action: "reissue_verified_token", terminal: false };
    case "ROOM_DELETED":
    case "ROOM_CLOSED": return { code: "room_ended", severity: "info", action: "end_session", terminal: true };
    case "DUPLICATE_IDENTITY": return { code: "duplicate_identity", severity: "warning", action: "show_duplicate_identity", terminal: true };
    case "PARTICIPANT_REMOVED": return { code: "participant_removed", severity: "warning", action: "show_removed", terminal: true };
    default: return { code: "provider_unreachable", severity: "warning", action: "show_unavailable", terminal: false };
  }
}
