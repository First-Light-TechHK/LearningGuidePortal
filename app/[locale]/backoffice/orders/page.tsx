import { redirect } from "next/navigation";
import { OrderManager } from "@/components/portal/OrderManager";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { currentOperatorUser } from "@/services/productAuth";

export default async function BackofficeOrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  if (!await currentOperatorUser()) redirect(`/${locale}/backoffice/sign-in`);
  return <OrderManager copy={getMessages(locale).backoffice.orders} />;
}
