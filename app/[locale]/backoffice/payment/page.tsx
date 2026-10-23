import { requireBackofficeMenu, requireBackofficeOperator } from "@/services/productAuth";
import { getPaymentSettings } from "@/services/productStore";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { PaymentSettingsForm } from "@/components/portal/PaymentSettingsForm";
import { BackofficeSettingsFrame } from "@/components/portal/BackofficeSettingsFrame";
import { canManageBackofficeEmployees } from "@/services/backofficeAccess";

export default async function BackofficePaymentPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  await requireBackofficeMenu(locale, "settings");
  const user = await requireBackofficeOperator(locale);
  const messages = getMessages(locale);
  return (
    <BackofficeSettingsFrame locale={locale} active="paymentGateway" manageEmployees={canManageBackofficeEmployees(user)}>
      <section className="backoffice-panel">
        <p className="portal-eyebrow">{messages.backoffice.payment.title}</p>
        <h1>{messages.backoffice.payment.title}</h1>
        <p className="portal-lead">{messages.backoffice.payment.description}</p>
        <PaymentSettingsForm initialSettings={await getPaymentSettings()} copy={messages.backoffice.payment} />
      </section>
    </BackofficeSettingsFrame>
  );
}
