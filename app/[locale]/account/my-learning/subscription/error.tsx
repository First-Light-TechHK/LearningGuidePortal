"use client";
import { useParams } from "next/navigation";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import styles from "@/components/portal/subscription-records.module.css";

export default function SubscriptionError({ reset }: { error: Error; reset: () => void }) {
  const locale = localeFrom(String(useParams().locale)), copy = getMessages(locale);
  return <main className={styles.routeState}><p role="alert">{copy.subscriptionDesign.loadError}</p><button type="button" className="portal-button portal-button-primary" onClick={reset}>{copy.subscriptionSelection.retry}</button></main>;
}
