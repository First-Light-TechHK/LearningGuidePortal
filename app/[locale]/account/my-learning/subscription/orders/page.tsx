import { redirect } from "next/navigation";
import { AccountNav } from "@/components/portal/AccountNav";
import { PendingOrders } from "@/components/portal/PendingOrders";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { subscriptionOrdersPath } from "@/lib/subscriptionOrdersPath";
import { listManagedOrders } from "@/services/orderPaymentService";
import { currentProductUser } from "@/services/productAuth";

export default async function SubscriptionOrdersPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ orderId?: string | string[] }> }) {
  const locale = localeFrom((await params).locale);
  const { orderId } = await searchParams;
  const selected = typeof orderId === "string" && orderId ? orderId : undefined;
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(subscriptionOrdersPath(locale, selected))}`);

  const orders = await listManagedOrders(user.id);
  const selectedOrder = selected ? orders.find(order => order.id === selected) : undefined;
  if (selectedOrder?.status === "paid" || selectedOrder?.status === "refunded") redirect(`/${locale}/account/my-learning/subscription`);
  const messages = getMessages(locale);
  return <main className="portal-page portal-account-page subscription-design-page">
    <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <AccountNav locale={locale} copy={messages.account} />
    <div className="portal-section portal-section-first">
      <PendingOrders initialOrders={orders} locale={locale} returnOrderId={selectedOrder?.id} />
    </div>
    <PortalFooter locale={locale} />
  </main>;
}
