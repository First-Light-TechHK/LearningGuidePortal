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

type TranslationPayload = {
  banners: BannerCopy[];
  categories: string[];
};

const RESPONSE_MAX_BYTES = 128 * 1024;
const COPY_KEYS = ["eyebrow", "title", "text", "cta"] as const;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= limit;
}

function validateContent(value: unknown): asserts value is PortalContent {
  if (!object(value) || !object(value.banners) || !Array.isArray(value.categories) || value.categories.length !== 3) throw new Error("Invalid portal translation content.");
  for (const locale of ["en-GB", "zh-CN"]) {
    const banners = value.banners[locale];
    if (!Array.isArray(banners) || banners.length !== 3 || banners.some(banner => !object(banner) || COPY_KEYS.some(key => !boundedText(banner[key], 500)) || typeof banner.image !== "string" || banner.image.length > 2048 || typeof banner.href !== "string" || banner.href.length > 2048)) throw new Error("Provide three complete banners in each language.");
    if (value.categories.some(category => !object(category) || !object(category.labels) || !boundedText(category.labels[locale], 80))) throw new Error("Provide complete category labels in each language.");
  }
  const ids = new Set(value.categories.map(category => category.id));
  if (ids.size !== 3 || ["Chinese Humanities", "European Humanities", "Science"].some(id => !ids.has(id))) throw new Error("Provide each supported category exactly once.");
}

function validatePayload(value: unknown, content: PortalContent, source: Locale): TranslationPayload {
  if (!object(value) || !Array.isArray(value.banners) || value.banners.length !== content.banners[source].length || !Array.isArray(value.categories) || value.categories.length !== content.categories.length) throw new Error("Translation must contain arrays covering every banner and category.");
  const banners = value.banners.map(copy => {
    if (!object(copy) || COPY_KEYS.some(key => !boundedText(copy[key], 500))) throw new Error("Translation returned incomplete banner copy.");
    return Object.fromEntries(COPY_KEYS.map(key => [key, (copy[key] as string).trim()])) as BannerCopy;
  });
  const categories = value.categories.map(label => {
    if (!boundedText(label, 80)) throw new Error("Translation returned an invalid category label.");
    return label.trim();
  });
  return { banners, categories };
}

async function readProviderBody(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Translation returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Translation response is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}

class TranslationTransportError extends Error {}

// Keep the deadline alive through body consumption. The shared streaming client
// aborts on return of headers, so this non-streaming CMS request is self-contained.
async function requestProvider(apiKey: string, payload: unknown): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TranslationTransportError("Translation request timed out."));
      }, 30_000);
    });
    try {
      return await Promise.race([(async () => {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST", signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://127.0.0.1:3007", "X-Title": process.env.OPENROUTER_APP_NAME || "Knowledge System" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          const message = `Translation failed (${response.status}).`;
          if ([429, 500, 502, 503, 504].includes(response.status)) throw new TranslationTransportError(message);
          throw new Error(message);
        }
        return await readProviderBody(response);
      })(), deadline]);
    } catch (error) {
      if (attempt || !(error instanceof TranslationTransportError || error instanceof TypeError || (error instanceof Error && error.name === "AbortError"))) throw error;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  throw new Error("Translation failed.");
}

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
  const body = await requestProvider(apiKey, {
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
  });
  if (!object(body) || !Array.isArray(body.choices) || !object(body.choices[0]) || !object(body.choices[0].message) || !boundedText(body.choices[0].message.content, 32_000)) throw new Error("Translation returned an invalid response.");
  return validatePayload(parseJsonPayload<unknown>(body.choices[0].message.content), content, source);
}

export async function translatePortalContent(content: PortalContent, source: Locale): Promise<{ content: PortalContent; skipped: boolean }> {
  if (source !== "en-GB" && source !== "zh-CN") throw new Error("Choose English or Simplified Chinese as the source language.");
  validateContent(content);
  const shared = withSharedBannerImages(content);
  if (translationIsCurrent(shared, source)) return { content: shared, skipped: true };
  const target = otherLocale(source);
  const payload = await requestTranslation(shared, source, target);
  const banners = {
    ...shared.banners,
    [target]: applyTranslatedBanners(shared.banners[source], payload.banners, target)
  };
  const categories = applyTranslatedCategories(shared.categories, payload.categories, target);
  const next = {
    ...shared,
    banners,
    categories,
    translation: { source, hash: sourceCopyFingerprint({ ...shared, banners, categories }, source) }
  };
  return { content: next, skipped: false };
}
