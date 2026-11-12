import { resolveLessonEntry } from "@/services/lessonEntryPolicy";
import { nextLessonHref } from "@/lib/lessonContinuation";
import { redirect, notFound } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { checkEntitlement, getLearningOverview, getProductCourse, getCourseLearningMode, getLessonBookmarks } from "@/services/productStore";
import { localeFrom } from "@/lib/i18n/config";
import { PreviewLessonView } from "@/components/portal/PreviewLessonView";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { previewLessonOutline } from "@/lib/previewLessonPresentation";
import { courseImageFor } from "@/components/portal/CourseThumbnail";
import { signCourseMediaUrl } from "@/services/persistence/s3";
import { sanitiseLessonContents } from "@/services/lessonContent";
import { signCourseMediaReferences } from "@/services/courseMediaSigning";
import { isCourseLearningMode } from "@/contracts/course-learning-mode";
import { courseExploration, lessonAssessmentAvailability } from "@/lib/lessonResources";
import { getTutorAvailability } from "@/services/ksTutorClient";

export const dynamic = "force-dynamic";

export default async function LearningPage({ params, searchParams }: { params: Promise<{ locale: string; courseId: string }>; searchParams: Promise<{ lessonId?: string; viewMode?: string; contentId?: string; resume?: string; modeSwitch?: string }> }) {
  const { locale: rawLocale, courseId } = await params;
  const locale = localeFrom(rawLocale);
  const { lessonId, viewMode, contentId, resume, modeSwitch } = await searchParams;
  const user = await currentProductUser();
  if (!user) {
    const query = new URLSearchParams();
    if (lessonId) query.set("lessonId", lessonId);
    if (contentId) query.set("contentId", contentId);
    if (isCourseLearningMode(viewMode)) query.set("viewMode", viewMode);
    if (resume === "1") query.set("resume", "1");
    if (modeSwitch === "1") query.set("modeSwitch", "1");
    const destination = `/${locale}/account/learn/${encodeURIComponent(courseId)}${query.size ? `?${query}` : ''}`;
    redirect(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(destination)}`);
  }
  const course = await getProductCourse(courseId);
  if (!course || course.status !== "published") notFound();
  const access = await checkEntitlement(user.id, course.id);
  if (!access.allowed) redirect(`/${locale}/portal/courses/${course.id}`);
  const lessons = course.sections.flatMap((section) => section.lessons.map((item) => ({ ...item, sectionTitle: section.title })));
  const lesson = lessonId ? lessons.find((item) => item.id === lessonId) : lessons[0];
  if (!lesson) notFound();
  lesson.contents = lesson.contents?.length ? await signCourseMediaReferences(sanitiseLessonContents(lesson.contents, course.id)) : undefined;
  const bookmarkSnapshot = await getLessonBookmarks(user.id, course.id);
  const overview = await getLearningOverview(user.id);
  const study = overview.courses.find((item) => item.courseId === course.id);
  const courseMode = await getCourseLearningMode(user.id, course.id);
  const entry = bookmarkSnapshot ? resolveLessonEntry({ lessonId: lesson.id, snapshot: bookmarkSnapshot, completed: Boolean(study?.completedLessonIds.includes(lesson.id)), courseMode, languageContinuation: resume === "1", switchingMode: modeSwitch === "1", requestedMode: isCourseLearningMode(viewMode) ? viewMode : null }) : { preferredMode: isCourseLearningMode(viewMode) ? viewMode : courseMode, initialContentId: contentId || null, bookmarkRestore: "position" as const };
  const poster = await signCourseMediaUrl(course.cover || course.thumbnailPath || courseImageFor(course.slug));
  const tutorAvailability = await getTutorAvailability(course.slug);
  return <main className="portal-page portal-public-lesson-page">
    <PortalHeader locale={locale} active="courses" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <PreviewLessonView {...entry} completedLessonIds={study?.completedLessonIds || []} bookmarkSnapshot={bookmarkSnapshot} bookmarkOwnerId={user.id} explorationData={courseExploration(course)} assessmentAvailability={lessonAssessmentAvailability(lesson)} completedContentIds={study?.completedContentIds || []} key={`${locale}:${lesson.id}`} locale={locale} courseId={course.id} courseTitle={course.title} category={course.category || ""} description={lesson.summary?.trim() || ""}
      lesson={{ id: lesson.id, title: lesson.title, body: lesson.body, durationMinutes: lesson.durationMinutes, contents: lesson.contents, preview: lesson.preview }} outline={previewLessonOutline(course, locale, true)} poster={poster} entitled tutorOnline={tutorAvailability.online}
      studyEndpoint="/api/study/events" initialCompleted={study?.completedLessonIds.includes(lesson.id) || false} nextHref={nextLessonHref(locale, course.id, lessons, lesson.id)} />
  </main>;
}
