import { redirect } from "next/navigation";

export default async function BackofficePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/backoffice/courses`);
}
