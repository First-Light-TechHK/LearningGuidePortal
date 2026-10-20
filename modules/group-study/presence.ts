import type { LiveSessionRow, PresenceRow, StudyGroupStore } from "./domain";

// The one place that decides who holds a seat in a Live Session and when an
// empty Live Session ends. Everything here is a pure function over the store
// snapshot that a service operation is already mutating, so every caller —
// enter, heartbeat, leave, start, the server sweep — applies the same rules.
//
// The model (QA 2026-10-19 root-cause redesign):
// - A seat is a LEASE held by the server. Entering grants it, the room page's
//   heartbeat renews it, and an explicit Leave (or leaving the Study Group)
//   releases it. A seat whose lease runs out is released at the moment it ran
//   out. Nothing else — no unload beacon, no LiveKit webhook, no provider
//   sweep — opens or closes a seat, so refresh, tab close, network loss and a
//   second tab all fall out of the same rule: whoever keeps renewing keeps the
//   seat, whoever stops loses it one lease later.
// - A live session ends when its last seat is released by an explicit Leave
//   (PRD BR-026 / BR-027), or when it has had no seat for a grace period
//   (refresh, tab close, network loss). The grace is what lets a reload come
//   back to the same live session instead of finding it ended (BUG-0108).

/** A seat lives this long after the last heartbeat (the client renews every 10 s). */
export const SEAT_LEASE_MS = 30_000;
/** A live session with no seat for this long ends on its own. */
export const EMPTY_LIVE_GRACE_MS = 60_000;

function lastSeenMs(presence: PresenceRow) {
  // Rows written before the lease existed carry no lastSeenAt: their entry
  // time is the last time the server saw them.
  return Date.parse(presence.lastSeenAt ?? presence.enteredAt ?? "");
}

/** The moment an open seat's lease runs out (NaN for a row that never entered). */
export function leaseEndsAt(presence: PresenceRow) {
  return lastSeenMs(presence) + SEAT_LEASE_MS;
}

export function seatHeld(presence: PresenceRow, now: Date) {
  if (!presence.enteredAt || presence.leftAt) return false;
  const ends = leaseEndsAt(presence);
  return Number.isFinite(ends) && ends > now.getTime();
}

export function heldSeats(store: StudyGroupStore, sessionId: string, now: Date) {
  return store.presences.filter((item) => item.sessionId === sessionId && seatHeld(item, now));
}

/** Seats currently held: the occupancy every reader and every admission check uses. */
export function seatCount(store: StudyGroupStore, sessionId: string, now: Date) {
  return heldSeats(store, sessionId, now).length;
}

/**
 * Writes down the seats whose lease ran out, closing each at the moment it
 * ran out (not "now"), so the persisted row says when the person was really
 * gone. Run inside every mutation that admits, renews or counts seats, so the
 * stored open-seat count (the PostgreSQL occupancy column and its CHECK) never
 * includes a lapsed seat. Returns how many seats it closed.
 */
export function closeLapsedSeats(store: StudyGroupStore, now: Date, sessionId?: string) {
  let closed = 0;
  for (const presence of store.presences) {
    if (sessionId && presence.sessionId !== sessionId) continue;
    if (!presence.enteredAt || presence.leftAt || seatHeld(presence, now)) continue;
    const ends = leaseEndsAt(presence);
    presence.leftAt = new Date(Number.isFinite(ends) ? Math.min(ends, now.getTime()) : now.getTime()).toISOString();
    closed += 1;
  }
  return closed;
}

export function completeSession(store: StudyGroupStore, session: LiveSessionRow, at: string) {
  session.status = "completed";
  session.completedAt = at;
  session.updatedAt = at;
  const meeting = store.meetings.find((item) => item.sessionId === session.id);
  if (meeting && !meeting.endedAt) meeting.endedAt = at;
}

/**
 * The moment a live session last became empty: the latest seat release, or
 * the start when nobody has taken a seat yet. Null while a seat is held.
 */
export function emptySince(store: StudyGroupStore, session: LiveSessionRow, now: Date): number | null {
  if (session.status !== "live" || seatCount(store, session.id, now) > 0) return null;
  let since = Date.parse(session.startedAt ?? session.updatedAt);
  for (const presence of store.presences) {
    if (presence.sessionId !== session.id || !presence.enteredAt) continue;
    const released = presence.leftAt ? Date.parse(presence.leftAt) : leaseEndsAt(presence);
    if (Number.isFinite(released) && released > since) since = released;
  }
  return Number.isFinite(since) ? since : now.getTime();
}

/**
 * Ends a live session that has had no seat for the grace period, dated to
 * the moment it became empty. Returns whether it ended the session.
 */
export function endAbandonedLiveSession(store: StudyGroupStore, session: LiveSessionRow, now: Date) {
  const since = emptySince(store, session, now);
  if (since === null || now.getTime() - since < EMPTY_LIVE_GRACE_MS) return false;
  completeSession(store, session, new Date(since).toISOString());
  return true;
}

/**
 * A seat that ran out (it was not released by a Leave) within the grace
 * period: its holder's phone went to the background or lost the network,
 * and the page re-enters when it comes back. A lapsed seat closed by the
 * sweep is dated to its lease end exactly; a Leave is dated to the request.
 */
function lapsedWithinGrace(presence: PresenceRow, now: Date) {
  if (!presence.enteredAt) return false;
  const ends = leaseEndsAt(presence);
  if (!Number.isFinite(ends) || ends > now.getTime() || now.getTime() - ends >= EMPTY_LIVE_GRACE_MS) return false;
  return !presence.leftAt || Date.parse(presence.leftAt) === ends;
}

/**
 * An explicit release (Leave Session, leaving the Study Group): a live
 * session whose last seat this was ends now, unless someone else's seat only
 * ran out moments ago. Then the grace period decides, as for a closed page,
 * so a member who is briefly offline comes back to the session instead of an
 * ended one (QA 2026-10-19 final review X-1).
 */
export function endLiveSessionIfEmpty(store: StudyGroupStore, session: LiveSessionRow, now: Date) {
  if (session.status !== "live" || seatCount(store, session.id, now) > 0) return false;
  if (store.presences.some((item) => item.sessionId === session.id && lapsedWithinGrace(item, now))) return false;
  completeSession(store, session, now.toISOString());
  return true;
}

/** The server sweep: persist lapsed leases everywhere and end abandoned live sessions. */
export function sweepSeats(store: StudyGroupStore, now: Date) {
  const seatsClosed = closeLapsedSeats(store, now);
  let sessionsEnded = 0;
  for (const session of store.sessions) {
    if (session.status === "live" && endAbandonedLiveSession(store, session, now)) sessionsEnded += 1;
  }
  return { seatsClosed, sessionsEnded };
}
