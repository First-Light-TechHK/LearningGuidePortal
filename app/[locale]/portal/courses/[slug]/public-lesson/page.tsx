import { notFound, redirect } from "next/navigation";
import { localeFrom } from "@/lib/i18n/config";
import { checkEntitlement, getLearningOverview, getProductCourse, listPublishedCourses, publicFirstLesson } from "@/services/productStore";
import { currentProductUser } from "@/services/productAuth";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { type TrialGate } from "@/components/portal/LessonContentPlayer";
import { PreviewLessonView } from "@/components/portal/PreviewLessonView";
import { previewLessonOutline } from "@/lib/previewLessonPresentation";
import { courseImageFor } from "@/components/portal/CourseThumbnail";
import { sanitiseLessonContents } from "@/services/lessonContent";
import { signCourseMediaReferences } from "@/services/courseMediaSigning";
import { signCourseMediaUrl } from "@/services/persistence/s3";

export default async function PublicLessonPage({ params, searchParams }: { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ lessonId?: string }> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = localeFrom(rawLocale);
  const course = await getProductCourse(slug);
  const requestedLesson = (await searchParams).lessonId;
  const lesson = course ? requestedLesson
    ? course.sections.flatMap(section => section.lessons).find(item => item.id === requestedLesson && item.isPublic)
    : publicFirstLesson(course) : null;
  if (!course || course.status !== "published" || !lesson) notFound();
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(`/${locale}/portal/courses/${course.id}/public-lesson${requestedLesson ? `?lessonId=${requestedLesson}` : ""}`)}`);
  const access = await checkEntitlement(user.id, course.id);
  const overview = await getLearningOverview(user.id);
  const record = overview?.courses.find(item => item.courseId === course.id);
  const next = course.sections.flatMap(section => section.lessons).find(item => item.isPublic && item.id !== lesson.id && !record?.completedLessonIds.includes(item.id));
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
    pricingHref: `/${locale}/pricing?courseId=${encodeURIComponent(course.id)}`,
    recommendations,
    videoLimitSeconds: 60,
    textStopLabel: "<Exh 3>",
    textStopParagraphs: 3
  };
  const contents = lesson.contents?.length ? await signCourseMediaReferences(sanitiseLessonContents(lesson.contents, course.id)) : undefined;
  const poster = await signCourseMediaUrl(course.cover || course.thumbnailPath || courseImageFor(course.slug));
  return <main className="portal-page portal-public-lesson-page">
    <PortalHeader locale={locale} active="courses" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <PreviewLessonView key={lesson.id} locale={locale} courseId={course.id} courseTitle={course.title} category={course.category || ""} description={course.subtitle || course.description} lesson={{ id: lesson.id, title: lesson.title, body: lesson.body, durationMinutes: lesson.durationMinutes, contents }} outline={previewLessonOutline(course, locale, access.allowed)} poster={poster} trialGate={trialGate} initialCompleted={Boolean(record?.completedLessonIds.includes(lesson.id))} entitled={access.allowed} nextHref={next ? `/${locale}/portal/courses/${course.id}/public-lesson?lessonId=${encodeURIComponent(next.id)}` : null} />
    <PortalFooter locale={locale} />
  </main>;
}
