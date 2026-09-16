import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { checkEntitlement, getLearningOverview, getProductCourse, listPublishedCourses, publicFirstLesson } from "@/services/productStore";
import { currentProductUser } from "@/services/productAuth";
import { PreviewProgress } from "@/components/portal/PreviewProgress";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { LessonContentPlayer } from "@/components/portal/LessonContentPlayer";
import { courseImageFor } from "@/components/portal/CourseThumbnail";
import { sanitiseLessonContents } from "@/services/lessonContent";

export default async function PublicLessonPage({ params, searchParams }: { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ lessonId?: string }> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = localeFrom(rawLocale);
  const course = await getProductCourse(slug);
  const requestedLesson = (await searchParams).lessonId;
  const lesson = course ? requestedLesson
    ? course.sections.flatMap(section => section.lessons).find(item => item.id === requestedLesson && item.isPublic)
    : publicFirstLesson(course) : null;
  if (!course || course.status !== "published" || !lesson) notFound();
  const messages = getMessages(locale);
  const copy = messages.portal;
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
  return <main className="portal-page portal-public-lesson-page">
    <PortalHeader locale={locale} active="courses" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <article className="public-lesson">
      <p className="portal-eyebrow">{copy.publicFirstLesson}</p><h1>{lesson.title}</h1><p className="lesson-duration">{lesson.durationMinutes} {messages.learning.minutes}</p>
      {lesson.contents?.length ? <LessonContentPlayer key={`content-${lesson.id}`} contents={sanitiseLessonContents(lesson.contents, course.id)} locale={locale} fallbackImageUrl="/portal/exh.jpg" trialGate={access.allowed ? undefined : { pricingHref: `/${locale}/pricing?courseId=${encodeURIComponent(course.id)}`, recommendations, videoLimitSeconds: 60, textStopLabel: "<Exh 3>" }}/> : <div className="lesson-body">{lesson.body.split("\n\n").map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>}
      <PreviewProgress key={`progress-${lesson.id}`} courseId={course.id} lessonId={lesson.id} seconds={lesson.durationMinutes * 60} initialCompleted={Boolean(record?.completedLessonIds.includes(lesson.id))} copy={{ ...messages.learning, saveError: messages.overviewDesign.previewSaveError }} />
      <div className="public-lesson-actions">
        {access.allowed ? <Link className="portal-button portal-button-secondary" href={`/${locale}/account/learn/${course.id}?lessonId=${encodeURIComponent(lesson.id)}`}>{messages.learning.continue}</Link> : next ? <Link className="portal-button portal-button-secondary" href={`/${locale}/portal/courses/${course.id}/public-lesson?lessonId=${encodeURIComponent(next.id)}`}>{messages.overviewDesign.continuePreview}</Link> : <Link className="portal-button portal-button-secondary" href={`/${locale}/pricing?courseId=${encodeURIComponent(course.id)}`}>{messages.learning.viewPlans}</Link>}
        <Link className="portal-text-link" href={`/${locale}/portal/courses/${course.id}`}>{copy.openCourse}</Link>
      </div>
    </article><PortalFooter locale={locale} />
  </main>;
}
