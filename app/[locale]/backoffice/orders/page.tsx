import { OrderManager } from "@/components/portal/OrderManager";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { requireBackofficeOperator } from "@/services/productAuth";

export default async function BackofficeOrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  await requireBackofficeOperator(locale);
  return <OrderManager copy={getMessages(locale).backoffice.orders} />;
}
