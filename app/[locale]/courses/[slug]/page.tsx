import { redirect } from "next/navigation";

export default async function CourseAlias({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  redirect(`/${locale}/portal/courses/${encodeURIComponent(slug)}`);
}
