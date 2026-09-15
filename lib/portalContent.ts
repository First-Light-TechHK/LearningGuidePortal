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
    { image: "/portal/auth-library.jpg", eyebrow: "LEARNING GUIDE", title: "Courses that give thinking room", text: "Study humanities and science through clear material, conversation and practice.", cta: "Explore courses", href: "/en-GB/portal/courses" },
    { image: "/portal/course-book.jpg", eyebrow: "START WITH A LESSON", title: "Begin with the public lesson", text: "See how each course is organised before you decide what to study next.", cta: "View courses", href: "/en-GB/portal/courses" },
    { image: "/portal/course-study.jpg", eyebrow: "MY LEARNING", title: "Keep your learning together", text: "Return to your lessons and continue with the course-aligned AI Tutor.", cta: "Go to My Learning", href: "/en-GB/account/my-learning" }
  ],
  "zh-CN": [
    { image: "/portal/auth-library.jpg", eyebrow: "LEARNING GUIDE", title: "给思考留下空间的课程", text: "通过清晰的材料、对话和练习学习人文与科学。", cta: "浏览课程", href: "/zh-CN/portal/courses" },
    { image: "/portal/course-book.jpg", eyebrow: "从一节课开始", title: "先阅读公开首课", text: "在决定下一步学习什么之前，先了解课程如何组织。", cta: "查看课程", href: "/zh-CN/portal/courses" },
    { image: "/portal/course-study.jpg", eyebrow: "MY LEARNING", title: "把学习记录放在一起", text: "回到课程内容，继续使用与课程一致的 AI Tutor。", cta: "进入 My Learning", href: "/zh-CN/account/my-learning" }
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
