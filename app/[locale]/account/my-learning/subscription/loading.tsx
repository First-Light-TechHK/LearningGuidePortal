"use client";
import { useParams } from "next/navigation";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import styles from "@/components/portal/subscription-records.module.css";

export default function LoadingSubscriptions() {
  const locale = localeFrom(String(useParams().locale));
  return <main className={styles.routeState} aria-busy="true"><p role="status">{getMessages(locale).subscriptionDesign.loading}</p></main>;
}
