import { notFound, redirect } from "next/navigation";
import { HelpdeskProblem, isTicketId, type TicketDetail } from "@/contracts/helpdesk";
import { EnquiryDetail } from "@/components/helpdesk/EnquiryDetail";
import { AccountNav } from "@/components/portal/AccountNav";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { learnerIdentity, supportPaths } from "@/modules/helpdesk/learnerPages";
import { helpdeskUiConfig } from "@/modules/helpdesk/learnerUiConfig";
import { helpdeskService } from "@/modules/helpdesk/runtime";
import { currentProductUser } from "@/services/productAuth";

export const dynamic = "force-dynamic";

/** One enquiry (no Figma frame yet: 待视觉验收). Someone else's ticket is a plain 404. */
export default async function EnquiryPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: rawLocale, id } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=${supportPaths(locale).ticket(encodeURIComponent(id))}`);
  if (!isTicketId(id)) notFound();
  const messages = getMessages(locale);
  let ticket: TicketDetail | null = null;
  let unavailable = false;
  try { ticket = await helpdeskService().getLearnerTicket(learnerIdentity(user), id.toLowerCase()); }
  catch (error) {
    if (error instanceof HelpdeskProblem && error.code === "not_found") notFound();
    unavailable = true;
  }
  return <main className="portal-page portal-account-page helpdesk-account-page">
    <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <AccountNav locale={locale} copy={messages.account} />
    <section className="portal-section portal-section-first helpdesk-account-section">
      {ticket ? <EnquiryDetail key={ticket.id} locale={locale} copy={messages.helpdesk} config={helpdeskUiConfig()} initial={ticket} /> : unavailable ? <p role="alert" className="helpdesk-inline-error">{messages.helpdesk.errors.unavailable}</p> : null}
    </section>
    <PortalFooter locale={locale} />
  </main>;
}
