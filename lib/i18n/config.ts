export const locales = ["en-GB", "zh-CN"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en-GB";

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

export function localeFrom(value: string | undefined): Locale {
  return value && isLocale(value) ? value : defaultLocale;
}
