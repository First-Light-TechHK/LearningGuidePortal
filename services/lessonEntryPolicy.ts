import type { LessonBookmarkSnapshot, LessonEntry } from "@/contracts/lesson-bookmark";
import type { CourseLearningMode } from "@/contracts/course-learning-mode";
import { latestLessonBookmark } from "@/lib/lessonBookmarkDisplay";

/** Completion is independent of entry position; valid bookmarks also resume reviews. */
export function resolveLessonEntry({ lessonId, snapshot, courseMode, languageContinuation = false, requestedMode = null, switchingMode = false }: {
  lessonId: string; snapshot: LessonBookmarkSnapshot; completed: boolean;
  courseMode: CourseLearningMode | null; languageContinuation?: boolean; requestedMode?: CourseLearningMode | null; switchingMode?: boolean;
}): LessonEntry {
  const explicitMode = (switchingMode || languageContinuation) && requestedMode;
  const selected = explicitMode ? snapshot.bookmarks[lessonId]?.[explicitMode] : undefined;
  const latest = explicitMode ? selected && snapshot.versions[lessonId]?.[selected.mode] === selected.contentVersion ? selected : undefined
    : latestLessonBookmark(snapshot.bookmarks, lessonId, snapshot.versions[lessonId]);
  const resume = latest;
  return {
    preferredMode: explicitMode || (resume ? latest.mode : courseMode || requestedMode),
    initialContentId: resume ? latest.contentId : null,
    bookmarkRestore: resume ? "lp" : "start",
  };
}
