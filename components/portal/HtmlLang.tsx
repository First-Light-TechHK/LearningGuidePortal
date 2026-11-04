"use client";

import { useEffect } from "react";
import type { Locale } from "@/lib/i18n/config";

// The root layout has no locale param and always renders lang="en-GB". Screen
// readers, browser translate and spell check read the document's language.
export function HtmlLang({ locale }: { locale: Locale }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
