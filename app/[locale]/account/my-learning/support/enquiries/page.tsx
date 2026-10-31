import Link from "next/link";
import { redirect } from "next/navigation";
import type { TicketSummary } from "@/contracts/helpdesk";
import { LocalTime, StatusPill } from "@/components/helpdesk/HelpdeskParts";
import "@/components/helpdesk/helpdesk.css";
import { AccountNav } from "@/components/portal/AccountNav";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { learnerIdentity, supportPaths } from "@/modules/helpdesk/learnerPages";
import { helpdeskService } from "@/modules/helpdesk/runtime";
import { currentProductUser } from "@/services/productAuth";

export const dynamic = "force-dynamic";

/** My enquiries (no Figma frame yet: 待视觉验收) — account layout, one card per ticket, newest activity first. */
export default async function EnquiriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const paths = supportPaths(locale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=${paths.enquiries}`);
  const messages = getMessages(locale);
  const copy = messages.helpdesk;
  let tickets: TicketSummary[] | null = null;
  try { tickets = (await helpdeskService().listLearnerTickets(learnerIdentity(user))).tickets; } catch { tickets = null; }
  return <main className="portal-page portal-account-page helpdesk-account-page">
    <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <AccountNav locale={locale} copy={messages.account} />
    <section className="portal-section portal-section-first helpdesk-account-section">
      <div className="helpdesk-list-heading"><div><h1>{copy.list.title}</h1><p>{copy.list.intro}</p></div><Link prefetch={false} className="helpdesk-submit-button" href={paths.form}>{copy.list.newEnquiry}</Link></div>
      {tickets === null ? <p role="alert" className="helpdesk-inline-error">{copy.errors.unavailable}</p>
        : tickets.length === 0 ? <div className="helpdesk-empty"><p>{copy.list.empty}</p><Link prefetch={false} className="helpdesk-secondary-button" href={paths.form}>{copy.list.newEnquiry}</Link></div>
        : <ul className="helpdesk-enquiry-list">{tickets.map((ticket) => <li key={ticket.id}>
          <Link prefetch={false} className="helpdesk-enquiry-card" href={paths.ticket(ticket.id)}>
            <span className="helpdesk-enquiry-main"><span className="helpdesk-enquiry-number">{ticket.number} · {copy.categories[ticket.category]}</span><strong>{ticket.subject}</strong></span>
            <span className="helpdesk-enquiry-side"><StatusPill status={ticket.status} copy={copy} /><span className="helpdesk-enquiry-updated">{copy.list.updated.split("{time}")[0]}<LocalTime iso={ticket.updatedAt} locale={locale} />{copy.list.updated.split("{time}")[1]}</span></span>
          </Link>
        </li>)}</ul>}
    </section>
    <PortalFooter locale={locale} />
  </main>;
}
