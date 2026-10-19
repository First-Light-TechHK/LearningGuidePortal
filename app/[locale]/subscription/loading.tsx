"use client";

import { useParams } from "next/navigation";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

export default function SubscriptionLoading() {
  return <section className="pricing-design-main"><p role="status">{getMessages(localeFrom(String(useParams().locale))).subscriptionSelection.loading}</p></section>;
}
