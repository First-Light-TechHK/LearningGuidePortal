import { nextLessonHref } from "@/lib/lessonContinuation";
import { notFound, redirect } from "next/navigation";
import { localeFrom } from "@/lib/i18n/config";
import { checkEntitlement, getLearningOverview, getProductCourse, getCourseLearningMode, listPublishedCourses, publicFirstLesson } from "@/services/productStore";
import { currentProductUser } from "@/services/productAuth";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { type TrialGate } from "@/components/portal/LessonContentPlayer";
import { PreviewLessonView } from "@/components/portal/PreviewLessonView";
import { previewLessonOutline } from "@/lib/previewLessonPresentation";
import { courseImageFor } from "@/components/portal/CourseThumbnail";
import { buildTextLessonPreview } from "@/services/textLessonPreview";
import { signCourseMediaReferences } from "@/services/courseMediaSigning";
import { signCourseMediaUrl } from "@/services/persistence/s3";
import { isCourseLearningMode } from "@/contracts/course-learning-mode";
import { getTutorAvailability } from "@/services/ksTutorClient";

export const dynamic = "force-dynamic";

export default async function PublicLessonPage({ params, searchParams }: { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ lessonId?: string; viewMode?: string }> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = localeFrom(rawLocale);
  const course = await getProductCourse(slug);
  const { lessonId: requestedLesson, viewMode } = await searchParams;
  const previewLesson = course ? publicFirstLesson(course) : null;
  const lesson = requestedLesson ? (requestedLesson === previewLesson?.id ? previewLesson : null) : previewLesson;
  if (!course || course.status !== "published" || !lesson) notFound();
  const user = await currentProductUser();
  if (!user) {
    const query = new URLSearchParams();
    if (requestedLesson) query.set("lessonId", requestedLesson);
    if (isCourseLearningMode(viewMode)) query.set("viewMode", viewMode);
    redirect(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(`/${locale}/portal/courses/${course.id}/public-lesson${query.size ? `?${query}` : ""}`)}`);
  }
  const access = await checkEntitlement(user.id, course.id);
  const preferredMode = isCourseLearningMode(viewMode) ? viewMode : await getCourseLearningMode(user.id, course.id);
  const overview = await getLearningOverview(user.id);
  const record = overview?.courses.find(item => item.courseId === course.id);
  const publishedCourses = await listPublishedCourses();
  const recommendationCourses = publishedCourses.slice(0, 2);
  const recommendations = recommendationCourses
    .map(item => ({
      title: item.title,
      href: `/${locale}/portal/courses/${item.id}`,
      image: item.cover || item.thumbnailPath || courseImageFor(item.slug || item.id),
      category: item.category
    }));
  for (const recommendation of recommendations) recommendation.image = await signCourseMediaUrl(recommendation.image || "");
  const trialGate: TrialGate | undefined = access.allowed ? undefined : {
    pricingHref: `/${locale}/subscription?courseId=${encodeURIComponent(course.id)}`,
    recommendations,
    videoLimitSeconds: 600
  };
  const preview = buildTextLessonPreview(lesson, course.id, access.allowed);
  const contents = preview.contents.length ? await signCourseMediaReferences(preview.contents) : undefined;
  const poster = await signCourseMediaUrl(course.cover || course.thumbnailPath || courseImageFor(course.slug));
  const tutorAvailability = await getTutorAvailability(course.slug);
  return <main className="portal-page portal-public-lesson-page">
    <PortalHeader locale={locale} active="courses" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <PreviewLessonView textPreview={preview.textPreview} completedContentIds={record?.completedContentIds || []} preferredMode={preferredMode} key={lesson.id} locale={locale} courseId={course.id} courseTitle={course.title} category={course.category || ""} description={lesson.summary?.trim() || ""} lesson={{ id: lesson.id, title: lesson.title, body: preview.body, durationMinutes: lesson.durationMinutes, contents }} outline={previewLessonOutline(course, locale, access.allowed)} poster={poster} trialGate={trialGate} initialCompleted={Boolean(record?.completedLessonIds.includes(lesson.id))} entitled={access.allowed} tutorOnline={tutorAvailability.online} nextHref={access.allowed ? nextLessonHref(locale, course.id, course.sections.flatMap(section => section.lessons), lesson.id) : null} />
  </main>;
}
