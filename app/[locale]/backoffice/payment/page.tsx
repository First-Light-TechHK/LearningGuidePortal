import Link from "next/link";
import { redirect } from "next/navigation";
import { currentOperatorUser } from "@/services/productAuth";
import { getPaymentSettings } from "@/services/productStore";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { PaymentSettingsForm } from "@/components/portal/PaymentSettingsForm";

export default async function BackofficePaymentPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  if (!await currentOperatorUser()) redirect(`/${locale}/backoffice/sign-in`);
  const messages = getMessages(locale);
  return (
    <main className="portal-page portal-page-narrow">
      <header className="portal-header">
        <span className="portal-brand"><span className="portal-brand-mark">LG</span><span>{messages.backoffice.title}</span></span>
        <nav className="portal-nav">
          <Link href={`/${locale}/backoffice/courses`}>{messages.backoffice.courses}</Link>
          <Link href={`/${locale}/backoffice/orders`}>{messages.backoffice.orders.title}</Link>
        </nav>
      </header>
      <section className="portal-section portal-section-first">
        <p className="portal-eyebrow">{messages.backoffice.payment.title}</p>
        <h1>{messages.backoffice.payment.title}</h1>
        <p className="portal-lead">{messages.backoffice.payment.description}</p>
        <PaymentSettingsForm initialSettings={await getPaymentSettings()} copy={messages.backoffice.payment} />
      </section>
    </main>
  );
}
