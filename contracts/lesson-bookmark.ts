export type LessonBookmarkInput = {
  courseId: string; lessonId: string; mode: "video" | "text"; contentId: string | null;
  contentVersion: string; expectedRevision: number; expectedLessonRevision: number; clientEventId: string;
  positionMs?: number; paragraphId?: string;
};
const allowedKeys = new Set(["courseId", "lessonId", "mode", "contentId", "contentVersion", "expectedRevision", "expectedLessonRevision", "clientEventId", "positionMs", "paragraphId"]);
const boundedString = (value: unknown, limit: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= limit;
export const lessonBookmarkInput = {
  safeParse(value: unknown): { success: true; data: LessonBookmarkInput } | { success: false } {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { success: false };
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(key => !allowedKeys.has(key))
      || !boundedString(input.courseId, 255) || !boundedString(input.lessonId, 255)
      || !["video", "text"].includes(String(input.mode))
      || !(input.contentId === null || boundedString(input.contentId, 255))
      || !boundedString(input.contentVersion, 128) || !boundedString(input.clientEventId, 128)
      || typeof input.expectedRevision !== "number" || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
      || typeof input.expectedLessonRevision !== "number" || !Number.isSafeInteger(input.expectedLessonRevision) || input.expectedLessonRevision < 0
      || (input.mode === "video"
        ? typeof input.positionMs !== "number" || !Number.isSafeInteger(input.positionMs) || input.positionMs < 0 || input.positionMs > 86_400_000 || input.paragraphId !== undefined
        : !boundedString(input.paragraphId, 512) || input.positionMs !== undefined)) return { success: false };
    return { success: true, data: input as LessonBookmarkInput };
  },
};

export type LessonBookmark = Omit<LessonBookmarkInput, "courseId" | "lessonId" | "expectedRevision" | "expectedLessonRevision"> & {
  revision: number;
  updatedAt: string;
  /** Server-derived LP number, never a display time. */
  lpNumber: string;
};
export type LessonBookmarks = Record<string, Partial<Record<"video" | "text", LessonBookmark>>>;
export class LessonBookmarkError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export type LessonBookmarkSnapshot = {
  bookmarks: LessonBookmarks;
  versions: Record<string, Partial<Record<"video" | "text", string>>>;
};

export type LessonBookmarkRestore = "position" | "lp" | "start";
export type LessonEntry = {
  preferredMode: "video" | "text" | null;
  initialContentId: string | null;
  bookmarkRestore: LessonBookmarkRestore;
};
