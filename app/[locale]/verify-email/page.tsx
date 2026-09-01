import { redirect } from "next/navigation";

export default async function VerifyEmailAlias({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { locale } = await params;
  const { token } = await searchParams;
  redirect(`/${locale}/portal/verify-email${token ? `?token=${encodeURIComponent(token)}` : ""}`);
}
