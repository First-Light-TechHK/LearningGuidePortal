import { redirect } from "next/navigation";

export default async function SettingsAlias({ params }: { params: Promise<{ locale: string }> }) {
  redirect(`/${(await params).locale}/account/my-learning/settings`);
}
