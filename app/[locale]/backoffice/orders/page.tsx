import Link from "next/link";
import { redirect } from "next/navigation";
import { OrderManager } from "@/components/portal/OrderManager";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { currentOperatorUser } from "@/services/productAuth";

export default async function BackofficeOrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  if (!await currentOperatorUser()) redirect(`/${locale}/backoffice/sign-in`);
  const messages = getMessages(locale);
  return (
    <main className="portal-page portal-page-narrow">
      <header className="portal-header">
        <span className="portal-brand"><span className="portal-brand-mark">LG</span><span>{messages.backoffice.title}</span></span>
        <nav className="portal-nav"><Link href={`/${locale}/backoffice/courses`}>{messages.backoffice.courses}</Link></nav>
      </header>
      <OrderManager copy={messages.backoffice.orders} />
    </main>
  );
}
