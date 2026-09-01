import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { AccountNav } from "@/components/portal/AccountNav";
import { SignOutButton } from "@/components/portal/SignOutButton";

export default async function HelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/account/my-learning/help`);
  const messages = getMessages(locale);
  const copy = messages.helpPage;
  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{messages.brand}</span></Link><SignOutButton label={messages.learning.signOut} locale={locale} /></header><AccountNav locale={locale} copy={messages.account} /><section className="portal-section portal-section-first"><p className="portal-eyebrow">{messages.account.help}</p><h1>{copy.title}</h1><div className="help-list">{copy.items.map((item) => <details className="help-item" key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div><p className="help-contact">{copy.contact}</p></section></main>;
}
