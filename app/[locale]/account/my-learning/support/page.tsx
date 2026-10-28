import { redirect } from "next/navigation";
import type { CommonQuestion } from "@/contracts/helpdesk";
import { ContactSupport } from "@/components/helpdesk/ContactSupport";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { createAdminHelpdeskClient } from "@/modules/helpdesk/adminClient";
import { supportPaths } from "@/modules/helpdesk/learnerPages";
import { helpdeskUiConfig } from "@/modules/helpdesk/learnerUiConfig";
import { currentProductUser } from "@/services/productAuth";

export const dynamic = "force-dynamic";

/** Contact Support (Figma 1216:6): the form, plus Admin's featured Common Questions when there are any. */
export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=${supportPaths(locale).form}`);
  const messages = getMessages(locale);
  let questions: CommonQuestion[] = [];
  try { questions = (await createAdminHelpdeskClient().commonQuestions(locale)) ?? []; } catch { questions = []; }
  return <main className="portal-page helpdesk-page">
    <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <ContactSupport locale={locale} copy={messages.helpdesk} config={helpdeskUiConfig()} account={{ name: user.nickname || "", email: user.email || "" }} questions={questions} />
    <PortalFooter locale={locale} />
  </main>;
}
