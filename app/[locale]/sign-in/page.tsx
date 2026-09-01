import { redirect } from "next/navigation";

export default async function SignInAlias({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const { locale } = await params;
  const { returnTo } = await searchParams;
  redirect(`/${locale}/portal/sign-in${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`);
}
