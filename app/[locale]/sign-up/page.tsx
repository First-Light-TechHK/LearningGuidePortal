import { redirect } from "next/navigation";

export default async function SignUpAlias({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const { locale } = await params;
  const { returnTo } = await searchParams;
  redirect(`/${locale}/portal/sign-up${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`);
}
