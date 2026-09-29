import type { Locale } from "@/lib/i18n/config";

export type Banner = { image: string; eyebrow: string; title: string; text: string; cta: string; href: string };
export type BannerCopy = Pick<Banner, "eyebrow" | "title" | "text" | "cta">;
export type PortalCategory = { id: "Chinese Humanities" | "European Humanities" | "Science"; labels: Record<Locale, string> };
export type PortalTranslation = { source: Locale; hash: string };
export type PortalContent = {
  banners: Record<Locale, Banner[]>;
  categories: PortalCategory[];
  countries: string[];
  supportUrl: string;
  translation?: PortalTranslation;
};

export const defaultBanners: Record<Locale, Banner[]> = {
  "en-GB": [
    { image: "/portal/auth-library.jpg", eyebrow: "", title: "Learn with curiosity.\nGrow with confidence.", text: "Learning Guide turns world-class cultural knowledge into a personal learning journey, in video or text, at your own pace.", cta: "Explore more", href: "/en-GB/portal/courses" },
    { image: "/portal/course-book.jpg", eyebrow: "", title: "Knowledge is the start.\nThinking is the destination.", text: "We're not chasing completion rates — we're building minds that question, connect, and see wider. Join a lifelong home for thinking.", cta: "Our Philosophy", href: "/en-GB/portal#why-us" },
    { image: "/portal/course-study.jpg", eyebrow: "", title: "Learn with an AI that gets you.\nGrow with people who push you.", text: "Your own AI Tutor for deep understanding — and a study community where real discussion happens. Thinking isn't meant to happen alone.", cta: "Join a Study Group", href: "/en-GB/portal/study-groups" }
  ],
  "zh-CN": [
    { image: "/portal/auth-library.jpg", eyebrow: "", title: "怀着好奇学习，\n带着自信成长。", text: "Learning Guide 将世界级的文化知识转化为个性化的学习旅程，通过视频或文本，按照自己的节奏学习。", cta: "查看更多", href: "/zh-CN/portal/courses" },
    { image: "/portal/course-book.jpg", eyebrow: "", title: "知识是起点。\n思考是终点。", text: "我们不追逐完成率——我们要培养会提问、会关联、看得更远的心智。欢迎加入这座终身思考之家。", cta: "我们的理念", href: "/zh-CN/portal#why-us" },
    { image: "/portal/course-study.jpg", eyebrow: "", title: "与懂你的 AI 一起学。\n与推动你的人一起成长。", text: "专属 AI Tutor 助你深入理解，还有真实讨论发生的学习社区。思考本就不该独自进行。", cta: "加入学习小组", href: "/zh-CN/portal/study-groups" }
  ]
};

export const defaultPortalContent: PortalContent = {
  banners: defaultBanners,
  categories: [
    { id: "Chinese Humanities", labels: { "en-GB": "Chinese Humanities", "zh-CN": "中国人文" } },
    { id: "European Humanities", labels: { "en-GB": "European Humanities", "zh-CN": "欧洲人文" } },
    { id: "Science", labels: { "en-GB": "Science", "zh-CN": "科学" } }
  ],
  countries: ["Australia", "Canada", "China", "France", "Germany", "Hong Kong SAR", "Ireland", "Singapore", "United Kingdom", "United States"],
  supportUrl: ""
};
defaultPortalContent.translation = { source: "en-GB", hash: sourceCopyFingerprint(defaultPortalContent, "en-GB") };

export function otherLocale(locale: Locale): Locale {
  return locale === "en-GB" ? "zh-CN" : "en-GB";
}

export function bundledPortalImages() {
  return [...new Set(defaultBanners["en-GB"].map((banner) => banner.image))];
}

export function localiseHref(href: string, locale: Locale) {
  return href.replace(/^\/(en-GB|zh-CN)(?=\/|$)/, `/${locale}`);
}

export function sourceCopyFingerprint(content: PortalContent, source: Locale) {
  return JSON.stringify({
    banners: content.banners[source].map(({ eyebrow, title, text, cta }) => ({ eyebrow, title, text, cta })),
    categories: content.categories.map((item) => item.labels[source])
  });
}

export function translationIsCurrent(content: PortalContent, source: Locale) {
  return content.translation?.source === source && content.translation.hash === sourceCopyFingerprint(content, source);
}

export function withSharedBannerImages(content: PortalContent): PortalContent {
  const en = content.banners["en-GB"];
  const zh = content.banners["zh-CN"];
  return {
    ...content,
    banners: {
      "en-GB": en.map((banner, index) => ({ ...banner, image: banner.image || zh[index]?.image || "" })),
      "zh-CN": zh.map((banner, index) => ({ ...banner, image: en[index]?.image || banner.image || "" }))
    }
  };
}

export function applyTranslatedBanners(source: Banner[], copies: BannerCopy[], target: Locale): Banner[] {
  if (copies.length !== source.length) throw new Error("Translation must cover every banner.");
  return source.map((banner, index) => {
    const copy = copies[index];
    for (const key of ["eyebrow", "title", "text", "cta"] as const) {
      if (typeof copy?.[key] !== "string" || !copy[key].trim() || copy[key].length > 500) {
        throw new Error("Translation returned incomplete banner copy.");
      }
    }
    return {
      image: banner.image,
      href: localiseHref(banner.href, target),
      eyebrow: copy.eyebrow.trim(),
      title: copy.title.trim(),
      text: copy.text.trim(),
      cta: copy.cta.trim()
    };
  });
}

export function applyTranslatedCategories(categories: PortalCategory[], labels: string[], target: Locale): PortalCategory[] {
  if (labels.length !== categories.length) throw new Error("Translation must cover every category.");
  return categories.map((category, index) => {
    const label = labels[index]?.trim();
    if (!label || label.length > 80) throw new Error("Translation returned an invalid category label.");
    return { ...category, labels: { ...category.labels, [target]: label } };
  });
}
