import type { LessonBookmarkSnapshot, LessonEntry } from "@/contracts/lesson-bookmark";
import type { CourseLearningMode } from "@/contracts/course-learning-mode";
import { latestLessonBookmark } from "@/lib/lessonBookmarkDisplay";

/** Completion changes entry position, never access or the saved bookmark. */
export function resolveLessonEntry({ lessonId, snapshot, completed, courseMode, languageContinuation = false, requestedMode = null, switchingMode = false }: {
  lessonId: string; snapshot: LessonBookmarkSnapshot; completed: boolean;
  courseMode: CourseLearningMode | null; languageContinuation?: boolean; requestedMode?: CourseLearningMode | null; switchingMode?: boolean;
}): LessonEntry {
  const selected = switchingMode && requestedMode ? snapshot.bookmarks[lessonId]?.[requestedMode] : undefined;
  const latest = switchingMode ? selected && snapshot.versions[lessonId]?.[selected.mode] === selected.contentVersion ? selected : undefined
    : latestLessonBookmark(snapshot.bookmarks, lessonId, snapshot.versions[lessonId]);
  const resume = latest && (!completed || languageContinuation);
  return {
    preferredMode: switchingMode && requestedMode ? requestedMode : resume ? latest.mode : courseMode || requestedMode,
    initialContentId: resume ? latest.contentId : null,
    bookmarkRestore: resume ? "lp" : "start",
  };
}
