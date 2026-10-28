"use client";
// Public Help Centre (Figma 1387:2, tickets-v2-figma-addendum §4d). The server
// page loads the articles (modules/helpdesk/helpCentre.ts); this renders them.
// Search is debounced into ?q= so Admin's own retrieval answers it on the
// server; ?category= and ?faq= are plain links. Answers open inline through
// the shared Markdown renderer. Search results, the empty states, the
// expanded answer and the fallback notice have no frame (待视觉验收).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, CircleHelp, Search } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FaqCategory } from "@/contracts/helpdesk";
import type { getMessages } from "@/lib/i18n/messages";
import type { HelpCentreView } from "@/modules/helpdesk/helpCentre";
import { fillTemplate } from "@/modules/helpdesk/learnerUi";
import { summaryLine } from "@/modules/helpdesk/markdown";
import { Markdown } from "./Markdown";
import "./helpdesk.css";

export type HelpCentreCopy = ReturnType<typeof getMessages>["helpCentre"];

const SEARCH_DEBOUNCE_MS = 300;
const TOPICS: FaqCategory[] = ["account_technical", "courses_learning", "payments_subscriptions", "other"];

export function HelpCentre({ locale, copy, view, contactHref }: { locale: "en-GB" | "zh-CN"; copy: HelpCentreCopy; view: HelpCentreView; contactHref: string }) {
  const router = useRouter();
  const root = `/${locale}/help`;
  const [value, setValue] = useState(view.q);
  const [open, setOpen] = useState<Set<string>>(() => new Set(view.openId ? [view.openId] : []));
  const typed = useRef(false);
  const sent = useRef(view.q);

  useEffect(() => { sent.current = view.q; }, [view.q]);

  function search(raw: string) {
    const q = raw.trim();
    if (q === sent.current) return;
    sent.current = q;
    router.replace(q ? `${root}?${new URLSearchParams({ q })}` : root);
  }

  useEffect(() => {
    if (!typed.current) return;
    const timer = setTimeout(() => search(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Only typing restarts the timer; search reads refs and the locale.
  }, [value]);

  useEffect(() => {
    const target = view.openId;
    if (!target) return;
    setOpen((current) => (current.has(target) ? current : new Set([...current, target])));
    document.getElementById(`faq-${target}`)?.scrollIntoView({ block: "center" });
  }, [view.openId]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    search(value);
  }

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const title = view.mode === "search" ? copy.searchTitle : view.mode === "category" && view.category ? copy.categories[view.category] : copy.popularTitle;
  const subtitle = view.mode === "search" ? fillTemplate(copy.searchSubtitle, { q: view.q }) : view.mode === "category" ? copy.categorySubtitle : copy.popularSubtitle;
  const empty = view.mode === "search" ? fillTemplate(copy.searchEmpty, { q: view.q }) : view.mode === "category" ? copy.categoryEmpty : copy.popularEmpty;

  return <div className="help-centre">
    <section className="help-centre-hero">
      <h1>{copy.title}</h1>
      <p>{copy.subtitle}</p>
      <form className="help-centre-search" role="search" action={root} method="get" onSubmit={onSubmit}>
        <Search size={22} aria-hidden="true" />
        <input type="search" name="q" aria-label={copy.searchLabel} placeholder={copy.searchPlaceholder} autoComplete="off" maxLength={240} value={value} onChange={(event) => { typed.current = true; setValue(event.target.value); }} />
      </form>
    </section>
    <div className="help-centre-content">
      <section className="help-centre-list" aria-labelledby="help-centre-list-title">
        <header className="help-centre-list-header">
          <h2 id="help-centre-list-title">{title}</h2>
          <p>{subtitle}</p>
          {view.mode === "popular" ? null : <Link prefetch={false} className="help-centre-back" href={root}>{copy.allArticles}</Link>}
        </header>
        {view.fallback ? <p className="help-centre-notice" role="status">{copy.unavailable}</p> : null}
        {view.articles.length === 0 ? <p className="help-centre-empty">{empty}</p> : <ul className="help-centre-articles">
          {view.articles.map((article) => {
            const expanded = open.has(article.id);
            const answerId = `faq-${article.id}-answer`;
            return <li key={article.id} id={`faq-${article.id}`} className={`help-centre-article${expanded ? " is-open" : ""}`}>
              <span className="help-centre-article-icon" aria-hidden="true"><CircleHelp size={20} /></span>
              <div className="help-centre-article-text">
                <button type="button" className="help-centre-article-question" aria-expanded={expanded} aria-controls={expanded ? answerId : undefined} onClick={() => toggle(article.id)}>{article.question}</button>
                <p className="help-centre-article-summary">{summaryLine(article.answer)}</p>
                {article.category ? <Link prefetch={false} className="help-centre-article-category" href={`${root}?category=${article.category}`}>{copy.categories[article.category]}</Link> : null}
                {expanded ? <Markdown className="help-centre-answer" text={article.answer} /> : null}
              </div>
            </li>;
          })}
        </ul>}
      </section>
      <aside className="help-centre-side">
        <h2>{copy.topicsTitle}</h2>
        <nav className="help-centre-topics" aria-label={copy.topicsTitle}>
          {TOPICS.map((topic) => <Link key={topic} prefetch={false} className="help-centre-topic" href={`${root}?category=${topic}`} aria-current={view.mode === "category" && view.category === topic ? "page" : undefined}><span>{copy.categories[topic]}</span><ChevronRight size={14} aria-hidden="true" /></Link>)}
        </nav>
        <div className="help-centre-side-divider" aria-hidden="true" />
        <section className="help-centre-contact" aria-labelledby="help-centre-contact-title">
          <h3 id="help-centre-contact-title"><CircleHelp size={20} aria-hidden="true" />{copy.contactTitle}</h3>
          <p>{copy.contactBody}</p>
          <Link prefetch={false} className="help-centre-contact-button" href={contactHref}>{copy.contactButton}</Link>
        </section>
      </aside>
    </div>
  </div>;
}
