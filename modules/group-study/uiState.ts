export type PaneStatus = "loading" | "error" | "ready";

export function studyGroupPane(input: { status: PaneStatus; selected: { role: "host" | "member" | null; sessions: unknown[] | null } | null }) {
  if (input.status === "loading") return { kind: "loading" as const };
  if (input.status === "error") return { kind: "error" as const };
  if (!input.selected) return { kind: "empty" as const };
  if (input.selected.sessions === null) return { kind: "join-gate" as const };
  return { kind: "sessions" as const };
}

export function sessionControls(input: { role: "host" | "member" | null; state: "scheduled" | "starting_soon" | "live" | "completed"; occupancy: number; maxParticipants: number }) {
  if (input.state === "live") return ["mic", "camera", "share", "participants", "raise-hand", "leave"];
  const actions: string[] = [];
  if (input.state === "starting_soon" && input.role === "host") actions.push("start");
  if (input.state === "starting_soon" && input.occupancy < input.maxParticipants) actions.push("join");
  if (input.state === "scheduled") actions.push("plan");
  return actions;
}
