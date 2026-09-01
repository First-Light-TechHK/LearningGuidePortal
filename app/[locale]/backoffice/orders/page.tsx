import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/portal/AccountNav";
import { OrderManager } from "@/components/portal/OrderManager";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { currentProductUser } from "@/services/productAuth";
import { isOperator } from "@/services/productStore";

export default async function BackofficeOrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/backoffice/orders`);
  const messages = getMessages(locale);
  if (!isOperator(user)) return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{messages.brand}</span></Link></header><section className="portal-detail"><p className="portal-eyebrow">{messages.backoffice.title}</p><h1>{messages.backoffice.restricted}</h1><p className="portal-lead">{messages.backoffice.operatorRequired}</p><Link className="portal-button portal-button-primary" href={`/${locale}/portal`}>{messages.backoffice.returnToPortal}</Link></section></main>;
  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{messages.brand}</span></Link><Link href={`/${locale}/backoffice/courses`}>{messages.backoffice.courses}</Link></header><OrderManager copy={messages.backoffice.orders} /></main>;
}
