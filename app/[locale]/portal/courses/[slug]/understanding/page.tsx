import { notFound, redirect } from "next/navigation";
import { localeFrom } from "@/lib/i18n/config";
import { currentProductUser } from "@/services/productAuth";
import { checkEntitlement, getProductCourse } from "@/services/productStore";
import { getUnderstandingOverview } from "@/services/understandingOverview";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { UnderstandingOverview } from "@/components/portal/UnderstandingOverview";

export default async function UnderstandingPage({ params, searchParams }: {
  params: Promise<{ locale:string; slug:string }>; searchParams: Promise<{ lessonId?:string; from?:string }>;
}) {
  const { locale:rawLocale, slug } = await params;
  const locale = localeFrom(rawLocale), query = await searchParams;
  const course = await getProductCourse(slug);
  if (!course || course.status !== "published") notFound();
  const lessons = course.sections.flatMap(section => section.lessons);
  const lesson = query.lessonId ? lessons.find(item => item.id === query.lessonId) : lessons[0];
  if (!lesson) notFound();
  const destination = `/${locale}/portal/courses/${encodeURIComponent(course.id)}/understanding?lessonId=${encodeURIComponent(lesson.id)}${query.from === "preview" ? "&from=preview" : ""}`;
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(destination)}`);
  if (!(await checkEntitlement(user.id, course.id)).allowed) redirect(`/${locale}/portal/courses/${encodeURIComponent(course.id)}`);
  const backHref = query.from === "preview" ? `/${locale}/portal/courses/${encodeURIComponent(course.id)}/public-lesson?lessonId=${encodeURIComponent(lesson.id)}` : `/${locale}/account/learn/${encodeURIComponent(course.id)}?lessonId=${encodeURIComponent(lesson.id)}`;
  return <main className="portal-page portal-public-lesson-page">
    <PortalHeader locale={locale} active="courses" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined}/>
    <UnderstandingOverview locale={locale} courseId={course.id} courseTitle={course.title} category={course.category || ""} backHref={backHref} data={await getUnderstandingOverview(user.id, course.id)}/>
  </main>;
}
