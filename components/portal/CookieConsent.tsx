"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

const COOKIE_PREFERENCE = "learning-guide-cookie-preference";

export function CookieConsent({ locale }: { locale: Locale }) {
  const copy = getMessages(locale).legal;
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setVisible(window.localStorage.getItem(COOKIE_PREFERENCE) === null);
  }, []);

  function save(value: "essential" | "optional") {
    window.localStorage.setItem(COOKIE_PREFERENCE, value);
    setVisible(false);
    setSaved(true);
  }

  if (saved || !visible) return null;
  return <aside className="cookie-consent" aria-label="Cookie preferences"><div><strong>{copy.cookiesTitle}</strong><p>{copy.cookiesIntro}</p><Link href={`/${locale}/cookie-policy`}>{copy.cookiesTitle}</Link></div><div className="cookie-consent-actions"><button className="portal-button portal-button-secondary" type="button" onClick={() => save("essential")}>{copy.rejectOptional}</button><button className="portal-button portal-button-primary" type="button" onClick={() => save("optional")}>{copy.acceptOptional}</button></div></aside>;
}
