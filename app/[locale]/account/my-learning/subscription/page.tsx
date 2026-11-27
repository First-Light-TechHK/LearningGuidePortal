import { redirect } from "next/navigation";
import { AccountNav } from "@/components/portal/AccountNav";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { SubscriptionManager } from "@/components/portal/SubscriptionManager";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { subscriptionOrdersPath } from "@/lib/subscriptionOrdersPath";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview } from "@/services/productStore";
import { presentSubscriptionOrders } from "@/services/subscriptionPresentationService";

export default async function SubscriptionPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ orderId?: string | string[] }> }) {
  const locale = localeFrom((await params).locale);
  const { orderId } = await searchParams;
  const selected = typeof orderId === "string" && orderId ? orderId : undefined;
  const user = await currentProductUser();
  if (!user) {
    const path = `/${locale}/account/my-learning/subscription`;
    const returnTo = selected ? `${path}?orderId=${encodeURIComponent(selected)}` : path;
    redirect(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  }

  const overview = await getLearningOverview(user.id);
  const selectedOrder = selected ? overview.orders.find(order => order.id === selected) : undefined;
  if (selectedOrder && selectedOrder.status !== "paid" && selectedOrder.status !== "refunded") redirect(subscriptionOrdersPath(locale, selected));
  const orders = await presentSubscriptionOrders(overview.orders.filter(order => order.status !== "pending"));
  const messages = getMessages(locale);
  return <main className="portal-page portal-account-page subscription-design-page">
    <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <AccountNav locale={locale} copy={messages.account} />
    <section className="portal-section portal-section-first">
      <h1>{messages.account.subscription}</h1>
      <p className="subscription-page-intro">{messages.subscriptionDesign.intro}</p>
      <SubscriptionManager initialSubscriptions={overview.subscriptions} initialOrders={orders} locale={locale} copy={{ ...messages.learning, title: messages.learning.subscription }} />
    </section>
    <PortalFooter locale={locale} />
  </main>;
}
