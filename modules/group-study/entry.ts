import type { EffectiveSessionState } from "./domain";

/**
 * Where a link to a Live Session sends the viewer (SG deep links, confirmed
 * with the product owner 2026-10-30). Every legal state goes on in one
 * click; only a state the viewer cannot pass stops on a page that says why
 * and offers the one way on. The server decides once, the page only renders
 * the answer.
 *
 * Nobody enters the room before the Host starts (PRD 6.9.1): from T-10 a
 * member waits in the list's waiting dialog ("wait") and the Host starts
 * from the session list ("host_start"); only a live session opens the room
 * ("enter").
 *
 * Order matters: a signed-out visitor learns nothing about the session; a
 * gone or finished session is said so before any purchase is offered; a
 * Course that is no longer offered is never sold or joined; a learner
 * without the Course is never asked to join a group they could not enter.
 */
export type SessionEntryNext =
  | "sign_in"
  | "unavailable"
  | "ended"
  | "course_unavailable"
  | "course_access"
  | "join_group"
  | "not_open"
  | "full"
  | "wait"
  | "host_start"
  | "enter";

export type SessionEntryFacts = {
  signedIn: boolean;
  /** The session exists, is not removed, and its Study Group is active. */
  found: boolean;
  state: EffectiveSessionState | null;
  /** Starting Soon past its planned end: never started, nobody can enter. */
  missed: boolean;
  /** The related Course is still published. */
  courseAvailable: boolean;
  courseAccess: boolean;
  member: boolean;
  host: boolean;
  /** The viewer can take (or already holds) a seat right now. */
  seatForViewer: boolean;
};

export function sessionEntryNext(facts: SessionEntryFacts): SessionEntryNext {
  if (!facts.signedIn) return "sign_in";
  if (!facts.found || !facts.state) return "unavailable";
  if (facts.state === "completed" || facts.missed) return "ended";
  // A member who still holds the Course keeps entering a Course that is no
  // longer offered; anyone who would have to buy it or join first is told
  // it is gone instead of being sent to buy or join.
  if (!facts.courseAccess) return facts.courseAvailable ? "course_access" : "course_unavailable";
  if (!facts.member) return facts.courseAvailable ? "join_group" : "course_unavailable";
  if (facts.state === "scheduled") return "not_open";
  // The Host's seat is kept for them until the start (seatsOpen), so the
  // Host is never refused here; they start from the list.
  if (facts.state === "starting_soon" && facts.host) return "host_start";
  if (!facts.seatForViewer) return "full";
  return facts.state === "live" ? "enter" : "wait";
}
