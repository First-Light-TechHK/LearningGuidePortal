import { expect, type Page } from "playwright/test";

// What a learner reads must be one language: the page's. The check reads what
// the browser renders, so it catches every source at once: a hard-coded string,
// a missing key, text from the server, or a date in the browser's language.
//
// Allowed in Chinese pages: the product terms AGENTS.md fixes in English, and the
// values a test passes (course titles and other data, not UI copy).
const ZH_ALLOWED = ["Learning Guide", "AI Tutor", "AI", "Stripe", "Google", "EN", "FAQ", "Cookie", "PDF", "MB"];
// The language switch names the other language in that language, on purpose.
const SWITCH_LABELS = ["切换到简体中文", "Switch to English (UK)", "中"];

export async function renderedText(page: Page, within?: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const root = selector ? document.querySelector(selector) ?? document.body : document.body;
    const out: string[] = [];
    const visible = (element: Element | null) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const box = element.getBoundingClientRect();
      return box.width > 1 && box.height > 1;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent?.trim();
      if (!text || !parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) continue;
      if (parent.closest("[hidden], .sr-only, [aria-hidden='true']")) continue;
      if (visible(parent)) out.push(text);
    }
    for (const element of root.querySelectorAll("[placeholder], [aria-label], [title]")) {
      // Ant Design names its icons in English for itself (aria-label="down").
      if (!visible(element) || element.closest(".anticon")) continue;
      for (const name of ["placeholder", "aria-label", "title"]) {
        const value = element.getAttribute(name)?.trim();
        if (value) out.push(value);
      }
    }
    return out;
  }, within);
}

export function foreignText(texts: string[], locale: "en-GB" | "zh-CN", data: string[] = []) {
  return texts.filter((text) => {
    if (SWITCH_LABELS.includes(text)) return false;
    let rest = text;
    for (const value of [...data].sort((a, b) => b.length - a.length)) rest = rest.split(value).join(" ");
    if (locale === "en-GB") return /[一-鿿]/.test(rest);
    for (const term of ZH_ALLOWED) rest = rest.split(term).join(" ");
    return /[A-Za-z]{2,}/.test(rest);
  });
}

export async function expectOneLanguage(page: Page, locale: "en-GB" | "zh-CN", data: string[] = [], within?: string) {
  await expect.poll(async () => foreignText(await renderedText(page, within), locale, data), { message: `${page.url()} shows text outside ${locale}` }).toEqual([]);
}
