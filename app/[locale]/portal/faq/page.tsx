import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";

export default async function FaqPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{messages.brand}</span></Link><nav className="portal-nav"><Link href={`/${locale}/portal/courses`}>{messages.portal.viewCourses}</Link><Link href={`/${locale}/portal/sign-in`}>{messages.portal.signIn}</Link></nav></header><section className="portal-section portal-section-first"><p className="portal-eyebrow">{messages.portal.faq}</p><h1>{messages.helpPage.title}</h1><div className="help-list">{messages.helpPage.items.map((item) => <details className="help-item" key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div></section></main>;
}
