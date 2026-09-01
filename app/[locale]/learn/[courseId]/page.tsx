import { redirect } from "next/navigation";

export default async function LearnAlias({ params, searchParams }: { params: Promise<{ locale: string; courseId: string }>; searchParams: Promise<{ lessonId?: string }> }) {
  const { locale, courseId } = await params;
  const { lessonId } = await searchParams;
  redirect(`/${locale}/account/learn/${encodeURIComponent(courseId)}${lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : ""}`);
}
