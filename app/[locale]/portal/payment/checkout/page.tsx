import Link from "next/link";
import { redirect } from "next/navigation";
import { LocalCheckout } from "@/components/portal/LocalCheckout";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { currentProductUser } from "@/services/productAuth";
import { demoCheckoutSignInReturnTo } from "@/lib/demoCheckoutReturnTo";
import { getOrderForUser } from "@/services/productStore";

export default async function LocalCheckoutPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ orderId?: string }> }) {
  const locale = localeFrom((await params).locale);
  const { orderId } = await searchParams;
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(demoCheckoutSignInReturnTo(locale, orderId))}`);
  const order = await getOrderForUser(user.id, orderId || "");
  if (!order || order.paymentMode !== "demo") redirect(`/${locale}/account/my-learning`);
  const messages = getMessages(locale);
  const copy = messages.learning;
  const isTrial = order.kind === "trial_activation";
  const isComplete = order.status === "paid";
  return <main className="portal-page portal-page-narrow"><PortalHeader locale={locale} signedIn /><section className="portal-section portal-section-first local-checkout-page"><p className="portal-eyebrow">{copy.localPayment}</p><h1>{copy.checkoutTitle}</h1><p className="portal-lead">{copy.checkoutDescription}</p><div className="local-checkout-summary"><div><span>{copy.orderStatus}</span><strong>{order.status === "pending" ? copy.pending : order.status === "paid" ? copy.paid : order.status === "failed" ? copy.failed : copy.canceledPayment}</strong></div><div><span>{copy.choosePlan}</span><strong>{order.plan?.name || order.planId}</strong></div><div><span>{copy.amount}</span><strong>{isTrial ? copy.trialNoCharge : `${(order.amountMinor / 100).toFixed(2)} ${order.currency.toUpperCase()}`}</strong></div></div>{isComplete ? <p className="portal-success">{copy.paymentReady}</p> : order.status === "pending" ? <LocalCheckout quoteId={order.quoteId} orderId={order.id} locale={locale} copy={{ complete: copy.completePayment, fail: copy.simulateFailure, cancel: copy.cancelPayment, processing: copy.processing, error: copy.checkoutError }} /> : <p className="portal-form-error">{order.failureReason || copy.paymentFailedDescription}</p>}<Link className="portal-text-link" href={`/${locale}/account/my-learning`}>{messages.portal.myLearning}</Link></section><PortalFooter locale={locale} /></main>;
}
