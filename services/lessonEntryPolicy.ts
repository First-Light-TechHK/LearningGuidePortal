import type { LessonBookmarkSnapshot, LessonEntry } from "@/contracts/lesson-bookmark";
import type { CourseLearningMode } from "@/contracts/course-learning-mode";
import { latestLessonBookmark, lessonModeBookmark } from "@/lib/lessonBookmarkDisplay";
import { availableLessonMode } from "@/lib/previewLessonPresentation";

/** Completion is independent of entry position; valid bookmarks also resume reviews. */
export function resolveLessonEntry({ lessonId, snapshot, courseMode, preferredCourseMode, availableModes, languageContinuation = false, requestedMode = null, switchingMode = false }: {
  lessonId: string; snapshot: LessonBookmarkSnapshot; completed: boolean;
  courseMode: CourseLearningMode | null; languageContinuation?: boolean; requestedMode?: CourseLearningMode | null; switchingMode?: boolean;
  preferredCourseMode?: CourseLearningMode | null; availableModes?: CourseLearningMode[];
}): LessonEntry {
  const chosenMode = preferredCourseMode || ((switchingMode || languageContinuation) ? requestedMode : null);
  const entryMode = chosenMode ? availableLessonMode(availableModes, chosenMode) : null;
  const resume = entryMode ? lessonModeBookmark(snapshot.bookmarks, lessonId, snapshot.versions[lessonId], entryMode)
    : latestLessonBookmark(snapshot.bookmarks, lessonId, snapshot.versions[lessonId]);
  return {
    preferredMode: entryMode || resume?.mode || courseMode || requestedMode,
    initialContentId: resume?.contentId || null,
    bookmarkRestore: resume ? "lp" : "start",
  };
}
