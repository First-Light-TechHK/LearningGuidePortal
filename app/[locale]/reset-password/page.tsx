import { redirect } from "next/navigation";

export default async function ResetPasswordAlias({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { locale } = await params;
  const { token } = await searchParams;
  redirect(`/${locale}/portal/reset-password${token ? `?token=${encodeURIComponent(token)}` : ""}`);
}
