"use client";

import { useParams } from "next/navigation";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

export default function SubscriptionError({ reset }: { reset: () => void }) {
  const copy = getMessages(localeFrom(String(useParams().locale))).subscriptionSelection;
  return <section className="pricing-design-main"><p role="alert">{copy.loadError}</p><button type="button" className="portal-button portal-button-primary" onClick={reset}>{copy.retry}</button></section>;
}
