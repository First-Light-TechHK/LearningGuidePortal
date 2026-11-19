import type { CoursePage } from "@/lib/coursePage";

export type CoursePageResponse = { ok: true; page: CoursePage };
export type CourseEntrySnapshot = Pick<CoursePage, "pageState" | "cta" | "actionLessonId" | "progress" | "openedLearningPointCount" | "bookmarkRevision" | "preferredMode"> & { continuableLessonIds?: string[]; completedLessonIds?: string[] };
