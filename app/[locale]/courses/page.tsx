import { redirect } from "next/navigation";

export default async function CoursesAlias({ params }: { params: Promise<{ locale: string }> }) {
  redirect(`/${(await params).locale}/portal/courses`);
}
