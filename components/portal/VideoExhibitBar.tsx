"use client";
import Image from "next/image";
import type { LessonNode } from "@/contracts/lesson-content";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { safeMediaUrl } from "./CourseMediaPreview";
import styles from "./video-exhibit-bar.module.css";

export function VideoExhibitBar({ node, locale, onDismiss, onView, variant = "video" }: { node: LessonNode; locale: Locale; onDismiss?: () => void; onView: () => void; variant?: "video" | "text" }) {
  const copy = getMessages(locale).videoExhibit;
  const thumbnail = node.type === "image" && safeMediaUrl(node.url) || "/portal/exhibit-prompt/thumbnail.png";
  const thumbnailSize = variant === "text" ? 58.207 : 60;
  return <section className={`${styles.bar} ${variant === "text" ? styles.text : ""}`} aria-label={copy.available} aria-live="polite">
    <Image className={styles.thumbnail} src={thumbnail} unoptimized width={thumbnailSize} height={thumbnailSize} alt=""/>
    <div className={styles.copy}><div className={styles.metadata}><span className={styles.kind}>{copy.types[node.type]}</span><span>{copy.available}</span></div><h2>{node.title || copy.untitled}</h2></div>
    {variant === "video" && onDismiss && <button type="button" className={styles.dismiss} onClick={onDismiss}>{copy.notNow}</button>}
    <button type="button" className={styles.view} onClick={onView}>{copy.view}<span aria-hidden="true">→</span></button>
  </section>;
}
