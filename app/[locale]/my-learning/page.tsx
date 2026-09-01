import { redirect } from "next/navigation";

export default async function MyLearningAlias({ params }: { params: Promise<{ locale: string }> }) {
  redirect(`/${(await params).locale}/account/my-learning`);
}
