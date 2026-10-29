import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ContactSupport } from "@/components/helpdesk/ContactSupport";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { parseOrderIdParam } from "@/contracts/helpdesk";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { createAdminHelpdeskClient } from "@/modules/helpdesk/adminClient";
import { supportPaths } from "@/modules/helpdesk/learnerPages";
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

/**
 * v4 Part A: ?orderId= from a payment record. Only the signed-in learner's own
 * order is shown (anything else, or an order store failure, opens the plain
 * form); POST /api/helpdesk/tickets checks ownership again.
 */
async function ownOrder(userId: string, raw: string | string[] | undefined) {
  const orderId = parseOrderIdParam(raw);
  if (!orderId) return null;
  try {
    const order = await learnerOrder(userId, orderId);
    return order ? { id: order.id } : null;
  } catch {
    return null;
  }
}

/** Contact Support (Figma 1216:6): the enquiry form and the AI Support Assistant chat panel. */
export default async function SupportPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams?: Promise<{ orderId?: string | string[] }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  const orderParam = (await searchParams)?.orderId;
  if (!user) {
    const back = parseOrderIdParam(orderParam);
    // Back to the same order after signing in (the plain form's returnTo is unchanged).
    redirect(`/${locale}/portal/sign-in?returnTo=${back ? encodeURIComponent(`${supportPaths(locale).form}?orderId=${back}`) : supportPaths(locale).form}`);
  }
  const messages = getMessages(locale);
  const [chips, order] = await Promise.all([popularChips(locale), ownOrder(user.id, orderParam)]);
  return <main className="portal-page helpdesk-page">
    <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <ContactSupport locale={locale} copy={messages.helpdesk} config={helpdeskUiConfig()} account={{ id: user.id, name: user.nickname || "", email: user.email || "" }} chips={chips} order={order} />
    <PortalFooter locale={locale} />
  </main>;
}
