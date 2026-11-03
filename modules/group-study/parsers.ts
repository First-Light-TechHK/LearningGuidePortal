// Request-body parsers for the Study Group Route Handlers (review 2026-11-03
// M1 / L2). Every field is untrusted: a wrong type is a 400 validation
// failure here, never a value the service stores as it came. The service
// still checks meaning (lengths, ranges, allowed durations); this layer only
// checks shape, the way contracts/helpdesk.ts does for Helpdesk.
import { StudyGroupError } from "./domain";

type Body = Record<string, unknown>;

function invalid(field: string, detail: string): never {
  throw new StudyGroupError("validation", `${field} ${detail}`);
}

/** A string field; absent or null reads as "" (the service decides whether it is required). */
function text(body: Body, field: string): string {
  const value = body[field];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") invalid(field, "must be text.");
  return value;
}

/** A nullable string field, left undefined when absent (an edit that does not touch it). */
function optionalText(body: Body, field: string): string | null | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") invalid(field, "must be text.");
  return value;
}

/** A number field, as a number or a numeric string (what the forms have always sent); anything else is 400. */
function number(body: Body, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" && typeof value !== "string") invalid(field, "must be a number.");
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) invalid(field, "must be a number.");
  return parsed;
}

/** A boolean field: only true or false count; "true", 1 or "no" are 400, never stored as a truthy value. */
// JSON null reads as "not sent", like an absent field.
function boolean(body: Body, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") invalid(field, "must be true or false.");
  return value;
}

export function parseCreateGroupBody(body: Body) {
  return { title: text(body, "title"), courseId: text(body, "courseId"), about: text(body, "about") };
}

export function parseEditGroupBody(body: Body) {
  const courseId = optionalText(body, "courseId");
  return { title: text(body, "title"), about: text(body, "about"), courseId: courseId ?? undefined };
}

export function parseScheduleSessionBody(body: Body) {
  return {
    title: text(body, "title"),
    startsAt: text(body, "startsAt"),
    // The service rejects anything but the allowed durations and 2-6 participants; NaN here means "missing".
    durationSeconds: number(body, "durationSeconds") ?? Number.NaN,
    maxParticipants: number(body, "maxParticipants") ?? Number.NaN,
    relatedLessonId: optionalText(body, "relatedLessonId"),
    focus: optionalText(body, "focus"),
    aiTutorEnabled: boolean(body, "aiTutorEnabled")
  };
}

export function parseEditSessionBody(body: Body) {
  const title = optionalText(body, "title");
  const startsAt = optionalText(body, "startsAt");
  return {
    groupId: text(body, "groupId"),
    title: title ?? undefined,
    relatedLessonId: optionalText(body, "relatedLessonId"),
    startsAt: startsAt ?? undefined,
    durationSeconds: number(body, "durationSeconds"),
    maxParticipants: number(body, "maxParticipants"),
    focus: optionalText(body, "focus"),
    aiTutorEnabled: boolean(body, "aiTutorEnabled")
  };
}
