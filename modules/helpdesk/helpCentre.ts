// Server-side data for the public Help Centre, /{locale}/help (Figma 1387:2,
// tickets-v2-figma-addendum §4d). Admin owns the FAQs; this only decides what
// to ask for (popular, a ?q= search through Admin's own retrieval, or a
// ?category=), loads a ?faq= deep link by id when it is not listed, and falls
// back to the static messages.helpPage.design copy when Admin is unavailable
// and nothing is cached, so the page never breaks. The 60 s cache and
// stale-on-error live in the Admin client.
import type { FaqCategory, FaqFilter, HelpCentreQuery, HelpFaq, HelpdeskLocale } from "@/contracts/helpdesk";
import { supportPaths } from "./learnerPages";

export type HelpCentreClient = {
  faqs(locale: HelpdeskLocale, filter?: FaqFilter): Promise<HelpFaq[] | null>;
  faq(id: string, locale: HelpdeskLocale): Promise<HelpFaq | null>;
};

/** One listed article; category is null for the static fallback copy. */
export type HelpArticle = { id: string; category: FaqCategory | null; question: string; answer: string };
export type HelpCentreView = {
  mode: "popular" | "search" | "category";
  q: string;
  category: FaqCategory | null;
  articles: HelpArticle[];
  /** The article to open and scroll to (?faq=). */
  openId: string | null;
  /** True when Admin was unavailable and the static copy is shown. */
  fallback: boolean;
};

export const HELP_POPULAR_LIMIT = 10;
export const HELP_LIST_LIMIT = 50;

const article = (faq: HelpFaq): HelpArticle => ({ id: faq.id, category: faq.category, question: faq.question, answer: faq.answer });

async function safely<T>(read: () => Promise<T | null>): Promise<T | null> {
  try { return await read(); } catch { return null; }
}

export async function loadHelpCentre(client: HelpCentreClient, locale: HelpdeskLocale, query: HelpCentreQuery, fallbackItems: { question: string; answer: string }[]): Promise<HelpCentreView> {
  const mode: HelpCentreView["mode"] = query.q ? "search" : query.category ? "category" : "popular";
  const base = { mode, q: query.q, category: mode === "category" ? query.category : null };
  let listed: HelpFaq[] | null;
  if (mode === "search") listed = await safely(() => client.faqs(locale, { q: query.q, limit: HELP_LIST_LIMIT }));
  else if (mode === "category") listed = await safely(() => client.faqs(locale, { category: query.category, limit: HELP_LIST_LIMIT }));
  else {
    listed = await safely(() => client.faqs(locale, { popular: true, limit: HELP_POPULAR_LIMIT }));
    if (listed && listed.length === 0) listed = await safely(() => client.faqs(locale, { limit: HELP_POPULAR_LIMIT }));
  }
  if (!listed) {
    const words = query.q.toLocaleLowerCase(locale);
    const items = fallbackItems.map((item, index) => ({ id: `static-${index}`, category: null, question: item.question, answer: item.answer }));
    return { ...base, articles: words ? items.filter((item) => `${item.question}\n${item.answer}`.toLocaleLowerCase(locale).includes(words)) : items, openId: null, fallback: true };
  }
  const articles = listed.map(article);
  let openId: string | null = null;
  if (query.faq) {
    if (articles.some((item) => item.id === query.faq)) openId = query.faq;
    else {
      const one = await safely(() => client.faq(query.faq as string, locale));
      if (one) { articles.unshift(article(one)); openId = one.id; }
    }
  }
  return { ...base, articles, openId, fallback: false };
}

/** Contact Support: the form for a signed-in learner; sign-in first (and back) for a visitor. */
export function contactSupportHref(locale: string, signedIn: boolean): string {
  const form = supportPaths(locale).form;
  return signedIn ? form : `/${locale}/portal/sign-in?returnTo=${encodeURIComponent(form)}`;
}
