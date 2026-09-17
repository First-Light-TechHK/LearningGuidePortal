export type LessonExhibitType = "article" | "video" | "image" | "audio" | "model3d" | "exercise";
export type LessonExhibit = { title: string; type: LessonExhibitType; url: string; html: string; missing: boolean };

export const TRIAL_STOP_SELECTOR = '[data-trial-stop="true"], [data-instance-type="3"]';

export function exhibitType(value: string | null | undefined): LessonExhibitType | null {
  if (value === "1") return "article";
  if (value === "2") return "video";
  if (value === "3") return "exercise";
  if (value === "4") return "image";
  if (value === "5") return "model3d";
  if (value === "6") return "audio";
  return null;
}

export function safeExhibitUrl(value: string | undefined): string {
  if (!value || /[\u0000-\u0020\\]/.test(value)) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

/** Prefer the sanitised src. Fallback image only when no exhibit URL exists. */
export function resolveLessonExhibit(input: {
  instanceType: string | null | undefined;
  instanceSrc?: string | null;
  instanceContent?: string | null;
  title?: string;
  fallbackImageUrl?: string | null;
}): LessonExhibit | null {
  const type = exhibitType(input.instanceType);
  if (!type) return null;
  const title = (input.title || "").trim() || "Exhibit";
  const raw = (input.instanceSrc || "").trim() || (input.instanceContent || "").trim();
  if (type === "article" || type === "exercise") return { title, type, url: "", html: raw, missing: false };
  const url = safeExhibitUrl(raw);
  if (url) return { title, type, url, html: "", missing: false };
  const fallback = safeExhibitUrl(input.fallbackImageUrl || "");
  return { title, type: "image", url: fallback, html: "", missing: !fallback };
}
