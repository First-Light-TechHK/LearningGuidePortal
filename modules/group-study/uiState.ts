export type PaneStatus = "loading" | "error" | "ready";

export function studyGroupPane(input: { status: PaneStatus; selected: { role: "host" | "member" | null; sessions: unknown[] | null } | null }) {
  if (input.status === "loading") return { kind: "loading" as const };
  if (input.status === "error") return { kind: "error" as const };
  if (!input.selected) return { kind: "empty" as const };
  if (input.selected.sessions === null) return { kind: "join-gate" as const };
  return { kind: "sessions" as const };
}

export function raisedHands(current: string[], identity: string, raised: boolean) {
  if (!identity) return current;
  if (raised) return current.includes(identity) ? current : [...current, identity];
  return current.filter((item) => item !== identity);
}

export function participantStatus(input: { mic: boolean; speaking: boolean }) {
  if (!input.mic) return "muted" as const;
  if (input.speaking) return "speaking" as const;
  return "mic-on" as const;
}

export function sessionStateLabel(state: "scheduled" | "starting_soon" | "live" | "completed") {
  if (state === "scheduled") return "upcoming" as const;
  if (state === "starting_soon") return "startingSoon" as const;
  if (state === "live") return "live" as const;
  return "completed" as const;
}

export function sessionControls(input: { role: "host" | "member" | null; state: "scheduled" | "starting_soon" | "live" | "completed"; occupancy: number; maxParticipants: number }) {
  if (input.state === "live") return ["mic", "camera", "share", "participants", "raise-hand", "leave"];
  const actions: string[] = [];
  if (input.state === "starting_soon" && input.role === "host") actions.push("start");
  if (input.state === "starting_soon" && input.occupancy < input.maxParticipants) actions.push("join");
  if (input.state === "scheduled") actions.push("plan");
  return actions;
}
