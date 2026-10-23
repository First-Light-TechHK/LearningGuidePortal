export type GroupRole = "host" | "member";
export type GroupStatus = "active" | "cancelled";
export type SessionStatus = "scheduled" | "live" | "completed" | "removed";
export type EffectiveSessionState = "scheduled" | "starting_soon" | "live" | "completed";

export type StudyGroupRow = {
  id: string;
  title: string;
  courseId: string;
  about: string;
  hostUserId: string;
  status: GroupStatus;
  createdAt: string;
  updatedAt: string;
};

export type MembershipRow = {
  id: string;
  groupId: string;
  userId: string;
  role: GroupRole;
  joinedAt: string;
  leftAt: string | null;
};

export type LiveSessionRow = {
  id: string;
  groupId: string;
  title: string;
  relatedLessonId: string | null;
  startsAt: string;
  durationSeconds: number;
  maxParticipants: number;
  focus: string | null;
  aiTutorEnabled: boolean;
  liveKitProjectId: string | null;
  status: SessionStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceIntentRow = {
  id: string;
  sessionId: string;
  userId: string;
  plannedAt: string;
  cancelledAt: string | null;
};

export type PresenceRow = {
  id: string;
  sessionId: string;
  userId: string;
  requestedAt: string;
  enteredAt: string | null;
  leftAt: string | null;
  phase: "waiting" | "live";
  // The seat lease (modules/group-study/presence.ts): when the server last
  // heard from the seat holder (entry or heartbeat). The seat is released one
  // lease after it. Optional: rows written before the lease existed read
  // their enteredAt instead.
  lastSeenAt?: string | null;
  // Legacy (audit F-5), no longer written: the LiveKit connection id the
  // participant_joined webhook used to record. Seats are decided by the lease
  // above alone; the column stays so existing rows and schemas keep loading.
  liveKitParticipantSid?: string | null;
};

export type MeetingRow = {
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
};

export type ReminderRow = {
  id: string;
  sessionId: string;
  userId: string;
  sentAt: string;
};

export type TutorRequestStatus = "queued" | "in_flight" | "answered" | "dead_letter";

export type TutorRequestRow = {
  id: string;
  sessionId: string;
  userId: string;
  clientEventId: string;
  text: string;
  receivedAt: string;
  inFlight: boolean;
  answeredAt?: string | null;
  // Durable queue fields (Phase C slice 1, design §3.1). Additive: the file
  // store leaves them undefined; the PostgreSQL adapter always sets them, and
  // inFlight mirrors `status === "in_flight"` on every row it returns.
  status?: TutorRequestStatus;
  seq?: number;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  nextAttemptAt?: string | null;
  attempts?: number;
  terminalReason?: string | null;
  outboxMessageId?: string | null;
};

export function tutorRequestState(row: TutorRequestRow): TutorRequestStatus {
  if (row.status) return row.status;
  if (row.answeredAt) return "answered";
  return row.inFlight ? "in_flight" : "queued";
}

// Fair answer order (tutor infra 2026-10-20): the room's questions are
// answered one at a time, by turns between askers — everyone's first
// question before anyone's second — and in receipt order within a turn. A
// question's turn is how many of the same asker's questions in this session
// came in before it, waiting or already answered; withdrawn and dead-lettered
// ones do not count. Counting answered ones keeps an asker whose first
// question was just answered from jumping back to the front. The PostgreSQL
// claim orders by the same key in SQL.
// Receipt order: received time, then the PostgreSQL sequence; the file store
// has no sequence, so its array order (append order) breaks the last tie.
function tutorReceiptOrder(index: Map<TutorRequestRow, number>) {
  return (left: TutorRequestRow, right: TutorRequestRow) =>
    left.receivedAt.localeCompare(right.receivedAt) || (left.seq ?? 0) - (right.seq ?? 0) || (index.get(left) ?? 0) - (index.get(right) ?? 0);
}

export function tutorFairTurn(rows: TutorRequestRow[], row: TutorRequestRow) {
  return tutorFairTurns(rows).get(row) ?? 0;
}

// Every row's turn in one pass: each asker's countable rows in receipt order.
export function tutorFairTurns(rows: TutorRequestRow[]) {
  const byAsker = new Map<string, TutorRequestRow[]>();
  for (const row of rows) {
    const key = `${row.sessionId}\u0000${row.userId}`;
    const list = byAsker.get(key);
    if (list) list.push(row);
    else byAsker.set(key, [row]);
  }
  const receipt = tutorReceiptOrder(new Map(rows.map((row, position) => [row, position])));
  const turns = new Map<TutorRequestRow, number>();
  for (const list of byAsker.values()) {
    list.sort(receipt);
    let counted = 0;
    for (const row of list) {
      turns.set(row, counted);
      if (tutorRequestState(row) !== "dead_letter") counted += 1;
    }
  }
  return turns;
}

export function compareTutorFairOrder(rows: TutorRequestRow[]) {
  const turns = tutorFairTurns(rows);
  const receipt = tutorReceiptOrder(new Map(rows.map((row, position) => [row, position])));
  return (left: TutorRequestRow, right: TutorRequestRow) => (turns.get(left) ?? 0) - (turns.get(right) ?? 0) || receipt(left, right);
}

// Who the AI Tutor answer replies to, so everyone in the room can tell which
// question an answer belongs to (QA 2026-10-19 N6).
export type TutorReplyTo = { name: string; question: string };
// `reason` is the failure class of an unavailable answer. It rides in the JSON
// payload: no schema change. The Tutor's reply format is KnowledgeSystem's.
export type TutorOutboxPayload = { room: string; projectId: string; text: string; messageId: string; mode?: string; replyTo?: TutorReplyTo; reason?: string };

export type OutboxKind = "room_message";
export type OutboxStatus = "queued" | "sending" | "delivered" | "failed" | "dead";

export type OutboxRow = {
  id: string;
  kind: OutboxKind;
  dedupeKey: string;
  sessionId: string;
  payload: TutorOutboxPayload;
  status: OutboxStatus;
  attempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  nextAttemptAt: string | null;
  failureClass: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

export type StudyGroupStore = {
  groups: StudyGroupRow[];
  memberships: MembershipRow[];
  sessions: LiveSessionRow[];
  intents: AttendanceIntentRow[];
  presences: PresenceRow[];
  meetings: MeetingRow[];
  reminders: ReminderRow[];
  tutorRequests: TutorRequestRow[];
  outbox: OutboxRow[];
};

export const SESSION_DURATION_SECONDS = [1800, 2700, 3600, 5400] as const;
export const STARTING_SOON_MS = 10 * 60 * 1000;
export const TOKEN_TTL_SECONDS = 10 * 60;

export function emptyStore(): StudyGroupStore {
  return { groups: [], memberships: [], sessions: [], intents: [], presences: [], meetings: [], reminders: [], tutorRequests: [], outbox: [] };
}

export function plannedEndMs(session: { startsAt: string; durationSeconds: number }) {
  return new Date(session.startsAt).getTime() + session.durationSeconds * 1000;
}

export function missedUnstarted(session: { status: string; startsAt: string; durationSeconds: number }, now: Date, occupancyCount: number) {
  return session.status === "scheduled" && occupancyCount === 0 && now.getTime() >= plannedEndMs(session);
}

export function effectiveSessionState(session: LiveSessionRow, now: Date): EffectiveSessionState | "removed" {
  if (session.status === "removed") return "removed";
  if (session.status === "completed") return "completed";
  if (session.status === "live") return "live";
  const opensAt = new Date(session.startsAt).getTime() - STARTING_SOON_MS;
  return now.getTime() >= opensAt ? "starting_soon" : "scheduled";
}

export class StudyGroupError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StudyGroupError";
    this.code = code;
  }
}
