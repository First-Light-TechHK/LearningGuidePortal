import type { LessonContent, LessonNode } from "@/contracts/lesson-content";
import type { ProductCourse, ProductLesson, ProductSection } from "@/services/productStore";
import type {
  AdminCourseDetail,
  AdminCourseSummary,
  AdminProjectionContent,
  AdminProjectionLesson,
  AdminProjectionNode,
  AdminProjectionSection,
} from "@/contracts/admin-portal-catalogue";

/**
 * Maps the Admin projection onto Portal's local `ProductCourse` read model.
 *
 * Pure functions only: no network, no storage, no environment reads. The mirror
 * (`services/adminCourseMirror.ts`) and the media proxy own the side effects.
 */

export const ADMIN_COURSE_CATEGORIES = ["Chinese Humanities", "European Humanities", "Science", "Society"] as const;
export type AdminCourseCategory = (typeof ADMIN_COURSE_CATEGORIES)[number];

const FALLBACK_CATEGORY: AdminCourseCategory = "European Humanities";
const MEDIA_PROXY_BASE = "/api/admin-course-media";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  const text = stringValue(value)?.trim();
  return text ? text : undefined;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringList(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

let warnedCategory: string | null = null;

/**
 * Admin category is free text; Portal's catalogue filter and pricing tracks only
 * understand the supported names. Unknown values fall back to European Humanities and log
 * once, so a typo in Admin is visible without flooding the log.
 */
export function mapAdminCategory(raw: unknown): AdminCourseCategory {
  const text = nonEmptyString(raw);
  if (text) {
    if (text.toLowerCase() === "社会") return "Society";
    const exact = ADMIN_COURSE_CATEGORIES.find(category => category.toLowerCase() === text.toLowerCase());
    if (exact) return exact;
    if (warnedCategory !== text) {
      warnedCategory = text;
      console.warn(JSON.stringify({ type: "admin-course-adapter", event: "unknown-category", category: text }));
    }
  }
  return FALLBACK_CATEGORY;
}

/**
 * The projection returns media as `/api/portal/v1/media/{courseId}/assets/{assetId}`.
 * The browser cannot send `X-API-Key`, so every URL is rewritten to Portal's own
 * same-origin proxy (`services/adminCourseMedia.ts`). Only the last path segment
 * is trusted, and the course id comes from our own record rather than the URL.
 */
export function adminAssetProxyUrl(adminCourseId: string, raw: unknown): string | undefined {
  const text = nonEmptyString(raw);
  if (!text) return undefined;
  const path = text.split("?")[0]!.split("#")[0]!;
  const assetId = path.split("/").filter(Boolean).pop();
  if (!assetId || assetId === "cover") return undefined;
  return `${MEDIA_PROXY_BASE}/${encodeURIComponent(adminCourseId)}/assets/${encodeURIComponent(assetId)}`;
}

const NODE_TYPES = new Set<LessonNode["type"]>(["text", "video", "image", "audio", "model3d", "exercise"]);

function mapNode(adminCourseId: string, raw: unknown, index: number): LessonNode | null {
  if (!isObject(raw)) return null;
  const type = raw.type;
  if (typeof type !== "string" || !NODE_TYPES.has(type as LessonNode["type"])) return null;
  const node: LessonNode = {
    id: nonEmptyString(raw.id) ?? `node-${index}`,
    title: nonEmptyString(raw.title) ?? `Exhibit ${index + 1}`,
    type: type as LessonNode["type"],
    triggerTime: finiteNumber(raw.triggerTime) ?? 0,
  };
  const url = adminAssetProxyUrl(adminCourseId, raw.url);
  if (url) node.url = url;
  const thumbnail = nonEmptyString(raw.thumbnail);
  if (thumbnail) node.thumbnail = thumbnail;
  return node;
}

function mapContent(adminCourseId: string, raw: unknown, index: number, lessonTitle: string): LessonContent | null {
  if (!isObject(raw)) return null;
  const payload = raw as AdminProjectionContent;
  if (payload.type !== "video" && payload.type !== "text" && payload.type !== "pdf") return null;
  const nodes = list(payload.nodes)
    .map((node, nodeIndex) => mapNode(adminCourseId, node, nodeIndex))
    .filter((node): node is LessonNode => Boolean(node));
  const base: LessonContent = {
    id: nonEmptyString(payload.id) ?? `content-${index}`,
    title: nonEmptyString(payload.title) ?? lessonTitle,
    type: payload.type,
    mode: payload.mode === "interactive" ? "interactive" : "lecture",
    nodes,
  };
  if (payload.type === "text") {
    base.html = stringValue(payload.html) ?? "";
    return base;
  }
  const url = adminAssetProxyUrl(adminCourseId, payload.url);
  if (url) base.url = url;
  return base;
}

function mapLesson(adminCourseId: string, raw: unknown, index: number): ProductLesson | null {
  if (!isObject(raw)) return null;
  const payload = raw as AdminProjectionLesson;
  const durationSeconds = finiteNumber(payload.durationSeconds);
  const lessonTitle = nonEmptyString(payload.title) ?? `Lesson ${index + 1}`;
  return {
    id: nonEmptyString(payload.id) ?? `lesson-${index}`,
    title: lessonTitle,
    // The projection carries protected text in `contents[].html`, not in `body`.
    body: "",
    summary: stringValue(payload.summary) ?? undefined,
    durationMinutes: durationSeconds === null ? 0 : Math.max(0, Math.ceil(durationSeconds / 60)),
    videoDurationSeconds: durationSeconds,
    isPublic: payload.isPublic === true,
    contents: list(payload.contents)
      .map((content, contentIndex) => mapContent(adminCourseId, content, contentIndex, lessonTitle))
      .filter((content): content is LessonContent => Boolean(content)),
  };
}

function mapSection(adminCourseId: string, raw: unknown, index: number): ProductSection | null {
  if (!isObject(raw)) return null;
  const payload = raw as AdminProjectionSection;
  return {
    id: nonEmptyString(payload.id) ?? `section-${index}`,
    title: stringValue(payload.title) ?? "",
    lessons: list(payload.lessons)
      .map((lesson, lessonIndex) => mapLesson(adminCourseId, lesson, lessonIndex))
      .filter((lesson): lesson is ProductLesson => Boolean(lesson)),
  };
}

function mapLevel(raw: unknown): ProductCourse["level"] {
  return raw === "beginner" || raw === "intermediate" || raw === "advanced" ? raw : undefined;
}

function provideTitles(raw: unknown): string[] {
  return list(raw)
    .map(item => isObject(item) ? nonEmptyString(item.title) : undefined)
    .filter((title): title is string => Boolean(title));
}

function baseCourse(adminCourseId: string, summary: AdminCourseSummary, now: string, previous?: ProductCourse): ProductCourse {
  const slug = nonEmptyString(summary.slug) ?? adminCourseId;
  const shortDescription = nonEmptyString(summary.shortDescription);
  const description = nonEmptyString(summary.description);
  const subtitle = nonEmptyString(summary.subtitle) ?? shortDescription;
  return {
    id: slug,
    slug,
    origin: "admin",
    adminCourseId,
    title: nonEmptyString(summary.title) ?? slug,
    description: shortDescription ?? description ?? "",
    subtitle,
    category: mapAdminCategory(summary.category),
    cover: `${MEDIA_PROXY_BASE}/${encodeURIComponent(adminCourseId)}/cover`,
    thumbnailPath: null,
    level: mapLevel(summary.level),
    tags: stringList(summary.tags),
    referencePrice: finiteNumber(summary.referencePrice),
    discount: finiteNumber(summary.discount),
    catalogueLessonCount: nonNegativeInteger(summary.lessonCount),
    catalogueDurationSeconds: finiteNumber(summary.totalDurationSeconds) !== null && summary.totalDurationSeconds! >= 0
      ? summary.totalDurationSeconds!
      : undefined,
    status: "published",
    sections: [],
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    adminSyncedAt: now,
  };
}

/** List row: identity and card fields only; sections arrive with the detail fetch. */
export function toProductCourseSummary(summary: AdminCourseSummary, now: string, previous?: ProductCourse): ProductCourse {
  return baseCourse(summary.id, summary, now, previous);
}

/** Detail row: adds outcomes, features and the full syllabus. */
export function toProductCourseDetail(detail: AdminCourseDetail, now: string, previous?: ProductCourse): ProductCourse {
  const course = baseCourse(detail.id, detail, now, previous);
  course.outcomes = stringList(detail.whatYouLearn);
  course.features = provideTitles(detail.provides);
  course.sections = list(detail.sections)
    .map((section, index) => mapSection(detail.id, section, index))
    .filter((section): section is ProductSection => Boolean(section));
  course.adminDetailSyncedAt = now;
  return course;
}
