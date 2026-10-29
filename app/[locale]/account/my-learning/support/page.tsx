import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ContactSupport } from "@/components/helpdesk/ContactSupport";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { createAdminHelpdeskClient } from "@/modules/helpdesk/adminClient";
import { supportOrder, supportSignInPath } from "@/modules/helpdesk/learnerPages";
import { helpdeskUiConfig } from "@/modules/helpdesk/learnerUiConfig";
import { learnerOrder } from "@/modules/helpdesk/runtime";
import { currentProductUser } from "@/services/productAuth";

export const dynamic = "force-dynamic";

/** Starter chips: the top 3 popular FAQs (Admin, 60 s cache in the client); none when Admin has none or is down. */
async function popularChips(locale: "en-GB" | "zh-CN") {
  try {
    const faqs = (await createAdminHelpdeskClient({ traceparent: (await headers()).get("traceparent") }).faqs(locale, { popular: true, limit: 3 })) ?? [];
    return faqs.slice(0, 3).map((faq) => ({ id: faq.id, question: faq.question }));
  } catch {
    return [];
  }
}

/** Contact Support (Figma 1216:6): the enquiry form and the AI Support Assistant chat panel. */
export default async function SupportPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams?: Promise<{ orderId?: string | string[] }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  const orderParam = (await searchParams)?.orderId;
  // Back to the same order after signing in (the plain form's returnTo is unchanged).
  if (!user) redirect(supportSignInPath(locale, orderParam));
  const messages = getMessages(locale);
  // v4 Part A: only the learner's own order is shown; one that cannot be attached opens the form with a notice.
  const [chips, { order, orderUnavailable }] = await Promise.all([popularChips(locale), supportOrder(orderParam, (orderId) => learnerOrder(user.id, orderId))]);
  return <main className="portal-page helpdesk-page">
    <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <ContactSupport locale={locale} copy={messages.helpdesk} config={helpdeskUiConfig()} account={{ id: user.id, name: user.nickname || "", email: user.email || "" }} chips={chips} order={order} orderUnavailable={orderUnavailable} />
    <PortalFooter locale={locale} />
  </main>;
}
