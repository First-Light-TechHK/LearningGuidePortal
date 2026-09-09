import {
  courseProgressFromUniqueLearningPoints,
  type AccessState,
} from "@/lib/myLearningOverview";

/** D1 Course page primitives — identity, syllabus access, CTA bands. */
export type CoursePageState = "available" | "withdrawn" | "failed";
export type SyllabusAccess = "previewable" | "locked" | "entitled";
export type CoursePageCta =
  | "start_preview"
  | "continue_preview"
  | "view_plans"
  | "continue_learning"
  | null;

export type CourseIdentity = {
  title: string;
  track: string;
  lessonCount: number;
  previewAvailable: boolean;
  totalMinutes: number;
};

export type CourseSyllabusItem = {
  lessonId: string;
  title: string;
  access: SyllabusAccess;
  openable: boolean;
};

export type CoursePage = {
  pageState: CoursePageState;
  identity: CourseIdentity | null;
  syllabus: CourseSyllabusItem[];
  cta: CoursePageCta;
  secondaryCta: CoursePageCta;
  accessState: AccessState;
  openedLearningPointCount: number;
  totalLearningPoints: number;
  progress: number | null;
  nextPreviewLessonId: string | null;
};

type CourseLike = {
  title: string;
  category?: string | null;
  status: string;
  sections: Array<{ lessons: Array<{ id: string; title: string; isPublic: boolean; durationMinutes?: number }> }>;
};

/** D1.1 Identity is title / track / lesson count / preview-available from the store. */
export function courseIdentityFrom(course: CourseLike): CourseIdentity {
  const lessons = course.sections.flatMap((section) => section.lessons);
  return {
    title: course.title,
    track: course.category || "European Humanities",
    lessonCount: lessons.length,
    previewAvailable: lessons.some((lesson) => lesson.isPublic),
    totalMinutes: lessons.reduce((total, lesson) => total + (lesson.durationMinutes || 0), 0),
  };
}

/** D1.2 Syllabus access: entitled when live access, else previewable vs locked. */
export function syllabusAccessForLesson(input: {
  pageState: CoursePageState;
  hasLiveEntitlement: boolean;
  isPublic: boolean;
}): SyllabusAccess {
  if (input.pageState !== "available") return "locked";
  if (input.hasLiveEntitlement) return "entitled";
  return input.isPublic ? "previewable" : "locked";
}

/** D1.3 Same access bands as My Learning: none / previewing / subscribed / expired. */
export function resolveCoursePageCta(input: {
  pageState: CoursePageState;
  hasLiveEntitlement: boolean;
  accessEnded: boolean;
  previewLessonIds: string[];
  openedLessonIds: string[];
  completedPreviewIds: string[];
}): CoursePageCta {
  if (input.pageState !== "available") return null;
  if (input.hasLiveEntitlement) return "continue_learning";
  if (input.accessEnded) return "view_plans";
  const previewRemaining = input.previewLessonIds.some((id) => !input.completedPreviewIds.includes(id));
  if (input.previewLessonIds.length > 0 && previewRemaining) {
    const openedPreview = input.openedLessonIds.some((id) => input.previewLessonIds.includes(id));
    return openedPreview ? "continue_preview" : "start_preview";
  }
  if (input.previewLessonIds.length > 0 && input.openedLessonIds.some((id) => input.previewLessonIds.includes(id))) {
    return "view_plans";
  }
  return "view_plans";
}

/** D1.4 From public content a visitor can still View plans (UC-PORTAL-2). */
export function resolveCoursePageSecondaryCta(cta: CoursePageCta): CoursePageCta {
  return cta === "start_preview" || cta === "continue_preview" ? "view_plans" : null;
}

export function emptyFailedCoursePage(): CoursePage {
  return {
    pageState: "failed",
    identity: null,
    syllabus: [],
    cta: null,
    secondaryCta: null,
    accessState: "none",
    openedLearningPointCount: 0,
    totalLearningPoints: 0,
    progress: null,
    nextPreviewLessonId: null,
  };
}

export function buildCoursePage(input: {
  course: CourseLike | null;
  hasLiveEntitlement: boolean;
  accessEnded: boolean;
  accessState: AccessState;
  openedLessonIds: string[];
  completedLessonIds: string[];
}): CoursePage {
  if (!input.course) return emptyFailedCoursePage();
  const pageState: CoursePageState = input.course.status === "published" ? "available" : "withdrawn";
  const lessons = input.course.sections.flatMap((section) => section.lessons);
  const previewLessons = lessons.filter((lesson) => lesson.isPublic);
  const previewLessonIds = previewLessons.map((lesson) => lesson.id);
  const completedPreviewIds = previewLessonIds.filter((id) => input.completedLessonIds.includes(id));
  const computed = courseProgressFromUniqueLearningPoints(input.openedLessonIds.length, lessons.length);
  const cta = resolveCoursePageCta({
    pageState,
    hasLiveEntitlement: input.hasLiveEntitlement,
    accessEnded: input.accessEnded,
    previewLessonIds,
    openedLessonIds: input.openedLessonIds,
    completedPreviewIds,
  });
  return {
    pageState,
    identity: courseIdentityFrom(input.course),
    syllabus: lessons.map((lesson) => {
      const access = syllabusAccessForLesson({
        pageState,
        hasLiveEntitlement: input.hasLiveEntitlement,
        isPublic: lesson.isPublic,
      });
      return { lessonId: lesson.id, title: lesson.title, access, openable: access === "previewable" || access === "entitled" };
    }),
    cta,
    secondaryCta: resolveCoursePageSecondaryCta(cta),
    accessState: input.accessState,
    openedLearningPointCount: input.openedLessonIds.length,
    totalLearningPoints: lessons.length,
    progress: computed.progress,
    nextPreviewLessonId: previewLessons.find((lesson) => !input.openedLessonIds.includes(lesson.id))?.id || null,
  };
}
