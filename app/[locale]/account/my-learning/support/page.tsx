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
import { helpdeskAssistant, learnerOrder } from "@/modules/helpdesk/runtime";
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
 * v5 Part A: the chat session for this visit, with the situation chips Portal's code picks from the learner's own
 * records (signals never leave the server) and the release's (or published) FAQs; null when it cannot start one
 * (no Helpdesk storage, or a failure), and the chat uses the starter chips as before.
 */
async function chatSession(user: { id: string; email?: string | null; nickname?: string | null }, locale: "en-GB" | "zh-CN", orderId: string | null) {
  try {
    const traceparent = (await headers()).get("traceparent");
    const request = new Request("http://portal.internal/", traceparent ? { headers: { traceparent } } : {});
    return await helpdeskAssistant(request).startSession({ id: user.id, email: user.email || "", name: user.nickname || "" }, { locale, orderId });
  } catch {
    return null;
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
  const { order, orderUnavailable } = await supportOrder(orderParam, (orderId) => learnerOrder(user.id, orderId));
  // v5: the session's situation chips; the popular starter chips when no session could be started, or when it has
  // none (Admin's list was not read in time; the FAQ list cache has had a moment to fill by now).
  const started = await chatSession(user, locale, order?.id ?? null);
  const chips = started?.chips.length ? started.chips : (await popularChips(locale)).map((chip) => ({ ...chip, reason: "popular" as const }));
  const session = started ? { ...started, chips, situational: started.situational && started.chips.length > 0 } : null;
  return <main className="portal-page helpdesk-page">
    <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <ContactSupport locale={locale} copy={messages.helpdesk} config={helpdeskUiConfig()} account={{ id: user.id, name: user.nickname || "", email: user.email || "" }} chips={chips} order={order} orderUnavailable={orderUnavailable} session={session} />
    <PortalFooter locale={locale} />
  </main>;
}
