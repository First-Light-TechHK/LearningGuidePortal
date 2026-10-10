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

export type TutorRequestRow = {
  id: string;
  sessionId: string;
  userId: string;
  clientEventId: string;
  text: string;
  receivedAt: string;
  inFlight: boolean;
  answeredAt?: string | null;
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
};

export const SESSION_DURATION_SECONDS = [1800, 2700, 3600, 5400] as const;
export const STARTING_SOON_MS = 10 * 60 * 1000;
export const TOKEN_TTL_SECONDS = 10 * 60;

export function emptyStore(): StudyGroupStore {
  return { groups: [], memberships: [], sessions: [], intents: [], presences: [], meetings: [], reminders: [], tutorRequests: [] };
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
