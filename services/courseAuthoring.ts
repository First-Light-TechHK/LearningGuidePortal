import { randomUUID } from "node:crypto";
import type { CourseDraftInput } from "@/contracts/course-authoring";
import type { ProductCourse } from "@/services/productStore";

export class AuthoringError extends Error {
  constructor(public code: "invalid" | "conflict" | "published" | "restricted" | "notFound") { super(code); }
}
function text(value: unknown, max: number, required = true): string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new AuthoringError("invalid");
  return value.trim();
}

// Apply to the current aggregate inside its transaction, never to a browser snapshot.
export function applyCourseDraft(course: ProductCourse, input: CourseDraftInput): ProductCourse {
  if (course.status !== "draft") throw new AuthoringError("published");
  if (input.expectedUpdatedAt !== course.updatedAt) throw new AuthoringError("conflict");
  if (!Array.isArray(input.sections) || input.sections.length > 100) throw new AuthoringError("invalid");
  const sectionIds = new Set(course.sections.map(section => section.id));
  const existingLessons = new Map(course.sections.flatMap(section => section.lessons.map(lesson => [lesson.id, lesson] as const)));
  const seen = new Set<string>();
  let publicCount = 0, lessonCount = 0;
  function identity(value: unknown, existing: Set<string> | Map<string, unknown>, kind: string) {
    const key = text(value, 200);
    if (seen.has(key) || (!existing.has(key) && !/^new-[a-z0-9-]+$/i.test(key))) throw new AuthoringError("invalid");
    seen.add(key);
    return existing.has(key) ? key : `${kind}_${randomUUID()}`;
  }
  const sections = input.sections.map(section => {
    if (!section || !Array.isArray(section.lessons)) throw new AuthoringError("invalid");
    return { id: identity(section.id, sectionIds, "section"), title: text(section.title, 255), lessons: section.lessons.map(lesson => {
      if (!lesson || ++lessonCount > 1000 || !Number.isInteger(lesson.durationMinutes) || lesson.durationMinutes < 1 || lesson.durationMinutes > 600 || typeof lesson.isPublic !== "boolean") throw new AuthoringError("invalid");
      if (lesson.videoDurationSeconds != null && (!Number.isInteger(lesson.videoDurationSeconds) || lesson.videoDurationSeconds < 0 || lesson.videoDurationSeconds > 36000)) throw new AuthoringError("invalid");
      if (lesson.isPublic && ++publicCount > 1) throw new AuthoringError("invalid");
      return { ...existingLessons.get(lesson.id), id: identity(lesson.id, existingLessons, "lesson"), title: text(lesson.title, 255), body: text(lesson.body, 200000), durationMinutes: lesson.durationMinutes, videoDurationSeconds: lesson.videoDurationSeconds ?? null, isPublic: lesson.isPublic };
    }) };
  });
  // Existing lesson IDs may be referenced by purchases, progress and KS links.
  // Removing existing lessons requires a separate archival policy, not a draft overwrite.
  if ([...existingLessons.keys()].some(id => !seen.has(id))) throw new AuthoringError("invalid");
  return { ...course, title: text(input.title, 255), description: text(input.description, 5000, false), sections,
    updatedAt: new Date(Math.max(Date.now(), Date.parse(course.updatedAt) + 1)).toISOString() };
}
