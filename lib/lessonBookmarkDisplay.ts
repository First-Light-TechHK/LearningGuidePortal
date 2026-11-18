import type { LessonBookmark, LessonBookmarks } from "@/contracts/lesson-bookmark";

export function latestLessonBookmark(bookmarks: LessonBookmarks, lessonId: string, versions?: Partial<Record<"video" | "text", string>>): LessonBookmark | undefined {
  return Object.values(bookmarks[lessonId] || {}).filter(bookmark => !versions || versions[bookmark.mode] === bookmark.contentVersion).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function bookmarkLessonRevision(bookmarks: LessonBookmarks, lessonId: string) {
  return Object.values(bookmarks[lessonId] || {}).reduce((sum, bookmark) => sum + bookmark.revision, 0);
}
