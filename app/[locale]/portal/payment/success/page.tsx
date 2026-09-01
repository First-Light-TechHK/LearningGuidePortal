import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview } from "@/services/productStore";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";

export default async function PaymentSuccessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in`);
  const overview = await getLearningOverview(user.id);
  const copy = getMessages(locale).learning;
  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{getMessages(locale).brand}</span></Link><Link href={`/${locale}/account/my-learning`}>{copy.title}</Link></header><section className="portal-detail"><p className="portal-eyebrow">{copy.purchaseComplete}</p><h1>{copy.purchaseComplete}</h1><p className="portal-lead">{copy.paymentReady}</p><Link className="portal-button portal-button-primary" href={`/${locale}/account/my-learning`}>{copy.continue}</Link><p className="portal-detail-meta">{overview.entitlements.length} {copy.activeEntitlements}</p></section></main>;
}
