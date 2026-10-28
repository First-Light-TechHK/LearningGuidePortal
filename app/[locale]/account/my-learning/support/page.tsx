import { redirect } from "next/navigation";
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

/** Starter chips: the top 3 popular FAQs (Admin, 60 s cache in the client); none when Admin has none or is down. */
async function popularChips(locale: "en-GB" | "zh-CN") {
  try {
    const faqs = (await createAdminHelpdeskClient().faqs(locale, { popular: true, limit: 3 })) ?? [];
    return faqs.slice(0, 3).map((faq) => ({ id: faq.id, question: faq.question }));
  } catch {
    return [];
  }
}

/** Contact Support (Figma 1216:6): the enquiry form and the AI Support Assistant chat panel. */
export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=${supportPaths(locale).form}`);
  const messages = getMessages(locale);
  const chips = await popularChips(locale);
  return <main className="portal-page helpdesk-page">
    <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <ContactSupport locale={locale} copy={messages.helpdesk} config={helpdeskUiConfig()} account={{ id: user.id, name: user.nickname || "", email: user.email || "" }} chips={chips} />
    <PortalFooter locale={locale} />
  </main>;
}
