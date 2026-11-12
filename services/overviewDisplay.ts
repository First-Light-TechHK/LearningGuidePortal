import type { OverviewDisplay, OverviewDisplayCourse } from "@/contracts/overview-display";
import type { Locale } from "@/lib/i18n/config";
import { availableCourseLearningModes } from "@/lib/courseLearningMode";
import { courseKnowledgePoints } from "@/lib/knowledgeProgress";
import { getLearningOverview, getPortalContent, getLessonBookmarks, listPublishedCourses, publicFirstLesson } from "./productStore";
import { latestLessonBookmark } from "@/lib/lessonBookmarkDisplay";
import { signCourseMediaUrl } from "./persistence/s3";

export async function getOverviewDisplay(userId: string, name: string, locale: Locale): Promise<OverviewDisplay> {
  const [overview, courses, portal] = await Promise.all([getLearningOverview(userId), listPublishedCourses(), getPortalContent()]);
  const catalogue = new Map(courses.map(course => [course.id, course]));
  const cards = await Promise.all([...overview.courses].sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).map(async (record): Promise<OverviewDisplayCourse | null> => {
    const course = catalogue.get(record.courseId);
    if (!course) return null;
    const lessons = course.sections.flatMap(section => section.lessons);
    const bookmarks = record.entitlement ? await getLessonBookmarks(userId, course.id) : null;
    const latest = bookmarks ? lessons.map(lesson => ({ lessonId: lesson.id, bookmark: latestLessonBookmark(bookmarks.bookmarks, lesson.id, bookmarks.versions[lesson.id]) }))
      .filter(item => item.bookmark).sort((a, b) => b.bookmark!.updatedAt.localeCompare(a.bookmark!.updatedAt))[0] : undefined;
    const completed = lessons.length > 0 && lessons.every(lesson => record.completedLessonIds.includes(lesson.id));
    const learningState = completed ? "completed" : latest ? "in_progress" : "not_started";
    const modes = availableCourseLearningModes(course);
    const mode = latest?.bookmark?.mode || (modes.includes(record.mode) ? record.mode : modes[0] || "text");
    const points = courseKnowledgePoints(course, mode);
    const position = points.find(point => point.lessonId === record.currentLessonId && point.contentId === record.currentContentId)
      || points.find(point => point.lessonId === record.currentLessonId) || points[0];
    const lessonId = record.entitlement ? (completed || !latest ? lessons[0]?.id : latest.lessonId) || null
      : position?.lessonId || lessons.find(lesson => lesson.id === record.currentLessonId)?.id || lessons[0]?.id || null;
    const contentId = record.entitlement ? (!completed ? latest?.bookmark?.contentId || null : null) : position?.contentId || null;
    // Compatibility only: display state comes from bookmarks and Lesson completion.
    const progress = !points.length ? null : record.progress;
    const category = portal.categories.find(item => item.id === course.categoryId || item.id === course.category || Object.values(item.labels).includes(course.category || ""));
    const query = new URLSearchParams({ viewMode:mode });
    if (lessonId) query.set("lessonId", lessonId);
    if (contentId) query.set("contentId", contentId);
    let action: OverviewDisplayCourse["action"] = "detail";
    let href = `/${locale}/portal/courses/${encodeURIComponent(course.slug)}`;
    if (progress !== null && lessonId && record.entitlement) {
      action = completed ? "review" : latest ? "resume" : "start";
      href = `/${locale}/account/learn/${encodeURIComponent(course.id)}?${query}`;
    } else if (progress !== null && record.cta === "continue_preview") {
      const preview = publicFirstLesson(course);
      const previewPoint = points.find(point => point.lessonId === preview?.id && point.contentId === contentId) || points.find(point => point.lessonId === preview?.id);
      const previewQuery = new URLSearchParams({ viewMode:mode });
      if (previewPoint?.contentId) previewQuery.set("contentId", previewPoint.contentId);
      action = "preview";
      href = `/${locale}/portal/courses/${encodeURIComponent(course.slug)}/public-lesson?${previewQuery}`;
    } else if (progress !== null && record.cta === "view_plans") {
      action = "plans";
      href = `/${locale}/subscription?courseId=${encodeURIComponent(course.id)}`;
    }
    return { id:record.id, courseId:course.id, title:course.title, category:category?.labels[locale] || course.category || "",
      cover:await signCourseMediaUrl(course.cover || course.thumbnailPath || "/portal/course-study.jpg"),
      lessonCount:lessons.length, currentLesson:lessonId ? lessons.findIndex(lesson => lesson.id === lessonId) + 1 : null,
      lessonId, contentId, progress, mode, action, href, learningState,
      lessonTitle: lessons.find(lesson => lesson.id === lessonId)?.title || null,
      bookmark: !completed && latest?.bookmark ? { mode: latest.bookmark.mode, lpNumber: latest.bookmark.lpNumber } : null };
  }));
  return { name, courses:cards.filter((card): card is OverviewDisplayCourse => card !== null),
    syncCourses: overview.courses.filter(record => catalogue.has(record.courseId)).map(record => ({
      courseId: record.courseId, mode: record.mode, currentLessonId: record.currentLessonId,
      currentContentId: record.currentContentId, progress: record.progress, updatedAt: record.updatedAt,
    })) };
}
