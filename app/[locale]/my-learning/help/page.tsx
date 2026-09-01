import { redirect } from "next/navigation";

export default async function HelpAlias({ params }: { params: Promise<{ locale: string }> }) {
  redirect(`/${(await params).locale}/account/my-learning/help`);
}
