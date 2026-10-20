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

export type StudyGroupDialogKind = "create" | "edit" | "edit-session" | "schedule" | "waiting" | "attendees" | "cancel-group" | "cancel-session" | "leave-group" | null;

/**
 * BUG-0100: exactly one error surface may render a given errorCode at a time.
 * The failing list pane owns the screen; otherwise the open dialog that the
 * mutation came from (create form or the edit/schedule modal) shows it; the
 * group sheet is the fallback so the sheet alert never doubles a dialog alert.
 */
export function studyGroupErrorPlace(input: { status: PaneStatus; dialog: StudyGroupDialogKind; hasSelected: boolean; hasError: boolean }): "pane" | "create" | "dialog" | "sheet" | "none" {
  if (!input.hasError) return "none";
  if (input.status === "error") return "pane";
  if (input.dialog === "create") return "create";
  if (input.dialog === "edit" || input.dialog === "edit-session" || input.dialog === "schedule" || input.dialog === "cancel-session" || input.dialog === "leave-group") return "dialog";
  if (input.hasSelected) return "sheet";
  return "none";
}

/**
 * F-2 (dev audit 2026-10-14): "error" was doing double duty as both the server's
 * generic 500 code (http.ts) and the client's "no error" sentinel, so a real 500
 * landed in the errorCode slot but rendered nowhere - the click appeared to do
 * nothing. The slot now idles under its own sentinel; every other code, "error"
 * included, is a real failure the one error slot must show.
 */
export function studyGroupHasError(errorCode: string) {
  return errorCode !== "idle";
}

export type StudyGroupMutationAction = "plan" | "cancel-attendance" | "cancel-session" | "leave";

/**
 * M3: Plan / Cancel Attendance / Cancel Session / Leave Group advance the UI only
 * after the server confirms the mutation. A failure reports its code through the
 * single errorCode slot and the sheet stays as it was; only a successful Leave
 * Group clears the selected panel, so a failed cancel can never look like a fake
 * success that the 3s poll then undoes.
 */
export function studyGroupMutation(input: { action: StudyGroupMutationAction; result: { ok: boolean; code: string } }): { ok: true; clearSelection: boolean } | { ok: false; errorCode: string } {
  if (!input.result.ok) return { ok: false, errorCode: input.result.code };
  return { ok: true, clearSelection: input.action === "leave" };
}

/**
 * BUG-0100: the reminder strip rendered the same notification body twice when the
 * server list carried two identical entries. Collapse repeated bodies to one row
 * (keeping the first/newest); distinct bodies are untouched.
 */
export function uniqueReminderBodies<T extends { body: string }>(reminders: T[]): T[] {
  const seen = new Set<string>();
  return reminders.filter((item) => {
    if (seen.has(item.body)) return false;
    seen.add(item.body);
    return true;
  });
}

/**
 * QA N10: what a failed list load does to the page. Before the first load
 * every failure is the page's error. After it, a failed 3 s poll keeps what
 * is on screen and the next poll heals it; a lost sign-in is the exception,
 * since no poll heals it and the error pane carries the sign-in link (N10-b).
 * A load the viewer asked for (a filter, a search, Retry, a change) always
 * shows its failure (N10-c).
 */
export function studyGroupListFailureShown(input: { poll: boolean; loadedOnce: boolean; code: string }) {
  if (!input.loadedOnce || input.code === "unauthenticated") return true;
  return !input.poll;
}

/**
 * QA M2 / M3: the sidebar's empty lines, only once the lists have loaded (no
 * flash of "no groups" during the first load). Hosted by Me has its own line,
 * and a Discover search that finds nothing says so.
 */
export function mineEmptyCopy(input: { signedIn: boolean; listsLoaded: boolean; filter: "all" | "host"; count: number }) {
  if (!input.signedIn || !input.listsLoaded || input.count > 0) return null;
  return input.filter === "host" ? "noHosted" as const : "noMine" as const;
}

export function discoverEmptyCopy(input: { listsLoaded: boolean; count: number; filtered: boolean }) {
  if (!input.listsLoaded || input.count > 0) return null;
  return input.filtered ? "noDiscoverMatch" as const : "noDiscover" as const;
}

export type StudyGroupNotice = "groupCancelled" | "sessionCancelled" | "sessionRescheduled";

// The waiting dialog's seat can no longer come back after these: the dialog
// closes and says why instead of waiting on (QA r2-B4 / r1-F-4).
const WAITING_TERMINAL_CODES = new Set(["session_full", "not_found", "session_unavailable", "session_not_open", "forbidden", "unauthenticated", "course_access_required"]);

export type WaitingDialogStep =
  | { kind: "keep" }
  | { kind: "reenter" }
  | { kind: "open-room" }
  | { kind: "close"; errorCode: string | null; notice: StudyGroupNotice | null };

/**
 * One reading of the server for the waiting dialog, from its heartbeat, its
 * re-enter or its session poll (the server's state decides, QA M9):
 * - gone (not_found): the session was cancelled; close with a notice;
 * - another terminal error: close and show it;
 * - back to scheduled: moved to a later time; close (which releases the seat)
 *   with a notice;
 * - completed: it ended without the viewer; close with that error;
 * - the seat lapsed: enter again;
 * - live: open the room;
 * - a transient failure (network, a 500) or anything else: keep waiting.
 */
export function waitingDialogStep(result: { ok: boolean; code: string; data?: { seated?: boolean; state?: string; occupancy?: number } | null }): WaitingDialogStep {
  if (!result.ok) {
    if (result.code === "not_found") return { kind: "close", errorCode: null, notice: "sessionCancelled" };
    if (WAITING_TERMINAL_CODES.has(result.code)) return { kind: "close", errorCode: result.code, notice: null };
    return { kind: "keep" };
  }
  const state = result.data?.state;
  if (state === "scheduled") return { kind: "close", errorCode: null, notice: "sessionRescheduled" };
  if (state === "completed") return { kind: "close", errorCode: "session_unavailable", notice: null };
  if (result.data?.seated === false) return { kind: "reenter" };
  if (state === "live") return { kind: "open-room" };
  return { kind: "keep" };
}
