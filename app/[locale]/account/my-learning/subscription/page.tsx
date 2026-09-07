import { redirect } from "next/navigation";
import { AccountNav } from "@/components/portal/AccountNav";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { SubscriptionManager } from "@/components/portal/SubscriptionManager";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview } from "@/services/productStore";

export default async function SubscriptionPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/account/my-learning/subscription`);
  const messages = getMessages(locale);
  const copy = messages.learning;
  const overview = await getLearningOverview(user.id);
  return <main className="portal-page"><PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} /><AccountNav locale={locale} copy={messages.account} /><section className="portal-section portal-section-first"><p className="portal-eyebrow">{messages.account.subscription}</p><h1>{copy.subscription}</h1><SubscriptionManager initialSubscriptions={overview.subscriptions} initialOrders={overview.orders} locale={locale} copy={{ title: copy.subscription, active: copy.active, trial: copy.trial, grace: copy.grace, cancelAtPeriodEnd: copy.cancelAtPeriodEnd, canceled: copy.canceled, expired: copy.expired, cancel: copy.cancel, resume: copy.resume, manage: copy.manage, validUntil: copy.validUntil, records: copy.records, date: copy.date, amount: copy.amount, receipt: copy.receipt, noReceipt: copy.noReceipt, paid: copy.paid, pending: copy.pending, failed: copy.failed, canceledPayment: copy.canceledPayment, refunded: copy.refunded, trialActivation: copy.trialActivation, cancelTitle: copy.cancelTitle, cancelDescription: copy.cancelDescription, cancelReason: copy.cancelReason, reasonLowUsage: copy.reasonLowUsage, reasonTooExpensive: copy.reasonTooExpensive, reasonContent: copy.reasonContent, reasonWebsite: copy.reasonWebsite, reasonOther: copy.reasonOther, reasonOtherPlaceholder: copy.reasonOtherPlaceholder, characters: copy.characters, confirmCancel: copy.confirmCancel, close: copy.close, updatePaymentMethod: copy.updatePaymentMethod, payNow: copy.payNow, plan: copy.plan, validPeriod: copy.validPeriod, upgrade: copy.upgrade }} /></section><PortalFooter locale={locale} /></main>;
}
