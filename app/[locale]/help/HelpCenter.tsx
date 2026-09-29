"use client";

import Image from "next/image";

type HelpItem = { question: string; answer: string };
type HelpCategory = { title: string; description: string; icon: string; items: HelpItem[] };

export function HelpCenter({ copy, locale }: { copy: { heroTitle: string; heroDescription: string; searchPlaceholder: string; browseTitle: string; popularTitle: string; faqTitle: string; supportTitle: string; supportDescription: string; contactSupport: string; categories: HelpCategory[]; popularArticles: HelpItem[]; faqItems: HelpItem[] }; locale: string }) {
  return <>
    <section className="help-hero"><div className="help-hero-content"><h1>{copy.heroTitle}</h1><p>{copy.heroDescription}</p></div></section>
    <section className="help-category-section" aria-labelledby="browse-categories"><h2 id="browse-categories">{copy.browseTitle}</h2><div className="help-category-grid">{copy.categories.map((category) => <button className="help-category-card" key={category.title} type="button" onClick={() => document.getElementById("help-faq")?.scrollIntoView({ behavior: "smooth" })}><span className="help-category-icon"><Image src={category.icon} width={24} height={24} alt="" /></span><strong>{category.title}</strong><span>{category.description}</span></button>)}</div></section>
    <section className="help-popular-section" aria-labelledby="popular-articles"><h2 id="popular-articles">{copy.popularTitle}</h2><div className="help-popular-grid">{copy.popularArticles.map((article) => <article className="help-popular-card" key={article.question}><div><h3>{article.question}</h3><p>{article.answer}</p></div><Image src="/portal/help/asset-4.svg" width={24} height={24} alt="" /></article>)}</div></section>
    <section className="help-faq-section" id="help-faq" aria-labelledby="faq-heading"><h2 id="faq-heading">{copy.faqTitle}</h2><div className="help-faq-list">{copy.faqItems.map((item) => <details key={item.question}><summary>{item.question}<Image src="/portal/help/asset-12.svg" width={20} height={20} alt="" /></summary><p>{item.answer}</p></details>)}</div></section>
    <section className="help-support-section"><Image src="/portal/help/asset-7.svg" width={72} height={64} alt="" /><h2>{copy.supportTitle}</h2><p>{copy.supportDescription}</p><a href={`/${locale}/contact`}>{copy.contactSupport}</a></section>
  </>;
}
