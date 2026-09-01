import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { getPaymentSettings, isOperator } from "@/services/productStore";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { PaymentSettingsForm } from "@/components/portal/PaymentSettingsForm";

export default async function BackofficePaymentPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/backoffice/payment`);
  const messages = getMessages(locale);
  if (!isOperator(user)) return <main className="portal-page portal-page-narrow"><section className="portal-detail"><h1>{messages.backoffice.restricted}</h1><p className="portal-lead">{messages.backoffice.operatorRequired}</p><Link className="portal-button portal-button-primary" href={`/${locale}/portal`}>{messages.backoffice.returnToPortal}</Link></section></main>;
  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{messages.brand}</span></Link><nav className="portal-nav"><Link href={`/${locale}/backoffice/courses`}>{messages.backoffice.courses}</Link><Link href={`/${locale}/backoffice/orders`}>{messages.backoffice.orders.title}</Link></nav></header><section className="portal-section portal-section-first"><p className="portal-eyebrow">{messages.backoffice.payment.title}</p><h1>{messages.backoffice.payment.title}</h1><p className="portal-lead">{messages.backoffice.payment.description}</p><PaymentSettingsForm initialSettings={await getPaymentSettings()} copy={messages.backoffice.payment} /></section></main>;
}
