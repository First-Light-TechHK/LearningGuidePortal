import { PaymentStatusRefresh } from "@/components/portal/PaymentStatusRefresh";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview, getOrderForUser } from "@/services/productStore";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";

export default async function PaymentSuccessPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ orderId?: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in`);
  const { orderId } = await searchParams;
  const order = orderId ? await getOrderForUser(user.id, orderId) : null;
  const overview = await getLearningOverview(user.id);
  const copy = getMessages(locale).learning;
  const state = order?.status || "unknown";
  const title = state === "paid" ? copy.purchaseComplete : state === "pending" ? copy.paymentPending : state === "failed" || state === "canceled" ? copy.paymentFailed : copy.paymentUnknown;
  const description = state === "paid" ? copy.paymentReady : state === "pending" ? copy.paymentPendingDescription : state === "failed" || state === "canceled" ? copy.paymentFailedDescription : copy.paymentUnknownDescription;
  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{getMessages(locale).brand}</span></Link><Link href={`/${locale}/account/my-learning`}>{copy.title}</Link></header><section className="portal-detail"><p className="portal-eyebrow">{title}</p><h1>{title}</h1><p className="portal-lead">{description}</p><PaymentStatusRefresh pending={state === "pending"} retryLabel={getMessages(locale).paymentErrors.checkAgain} /><Link className="portal-button portal-button-primary" href={`/${locale}/account/my-learning`}>{copy.continue}</Link><p className="portal-detail-meta">{overview.entitlements.filter((entitlement) => entitlement.state === "active").length} {copy.activeEntitlements}</p></section></main>;
}
