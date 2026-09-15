import type { Locale } from "@/lib/i18n/config";
import {
  applyTranslatedBanners,
  applyTranslatedCategories,
  otherLocale,
  sourceCopyFingerprint,
  translationIsCurrent,
  withSharedBannerImages,
  type BannerCopy,
  type PortalContent
} from "@/lib/portalContent";
import { fetchOpenRouter } from "./openRouterClient";

type TranslationPayload = {
  banners?: BannerCopy[];
  categories?: string[];
};

export function parseJsonPayload<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed) as T;
}

function languageName(locale: Locale) {
  return locale === "zh-CN" ? "Simplified Chinese" : "British English";
}

async function requestTranslation(content: PortalContent, source: Locale, target: Locale): Promise<TranslationPayload> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Automatic translation is not configured.");
  const model = process.env.OPENROUTER_MODEL || "openrouter/auto";
  const response = await fetchOpenRouter(apiKey, {
    model,
    temperature: 0.15,
    max_tokens: 1600,
    messages: [
      {
        role: "system",
        content: "You translate Learning Guide homepage copy. Return JSON only with keys banners (array of {eyebrow,title,text,cta}) and categories (array of short labels). Keep brand names Learning Guide, My Learning and AI Tutor. Do not add commentary."
      },
      {
        role: "user",
        content: JSON.stringify({
          from: languageName(source),
          to: languageName(target),
          banners: content.banners[source].map(({ eyebrow, title, text, cta }) => ({ eyebrow, title, text, cta })),
          categories: content.categories.map((item) => item.labels[source])
        })
      }
    ]
  }, { timeoutMs: 30000, attempts: 2 });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Translation failed (${response.status}).`);
  }
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error("Translation returned an empty response.");
  return parseJsonPayload<TranslationPayload>(text);
}

export async function translatePortalContent(content: PortalContent, source: Locale): Promise<{ content: PortalContent; skipped: boolean }> {
  if (source !== "en-GB" && source !== "zh-CN") throw new Error("Choose English or Simplified Chinese as the source language.");
  const shared = withSharedBannerImages(content);
  if (translationIsCurrent(shared, source)) return { content: shared, skipped: true };
  const target = otherLocale(source);
  const payload = await requestTranslation(shared, source, target);
  const banners = {
    ...shared.banners,
    [target]: applyTranslatedBanners(shared.banners[source], payload.banners || [], target)
  };
  const categories = applyTranslatedCategories(shared.categories, payload.categories || [], target);
  const next = {
    ...shared,
    banners,
    categories,
    translation: { source, hash: sourceCopyFingerprint({ ...shared, banners, categories }, source) }
  };
  return { content: next, skipped: false };
}
