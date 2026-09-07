import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";

export default async function PublicHelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  return <main className="portal-page"><PortalHeader locale={locale} signedIn={Boolean(await currentProductUser())} /><section className="portal-section portal-section-first help-page"><p className="portal-eyebrow">{messages.account.help}</p><h1>{messages.helpPage.title}</h1><div className="help-category-list">{messages.helpPage.categories.map((category) => <section className="help-category" key={category.title}><h2>{category.title}</h2><div className="help-list">{category.items.map((item) => <details className="help-item" key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div></section>)}</div><p className="help-contact">{messages.helpPage.contact}</p></section><PortalFooter locale={locale} /></main>;
}
