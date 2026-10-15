"use client";
import Image from "next/image";
import type { LessonNode } from "@/contracts/lesson-content";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { safeMediaUrl } from "./CourseMediaPreview";
import styles from "./video-exhibit-bar.module.css";

export function VideoExhibitBar({ node, locale, onDismiss, onView, variant = "video", presentation = "inline" }: { node: LessonNode; locale: Locale; onDismiss?: () => void; onView: () => void; variant?: "video" | "text"; presentation?: "inline" | "fullscreen" }) {
  const copy = getMessages(locale).videoExhibit;
  const thumbnail = node.type === "image" && safeMediaUrl(node.url) || "/portal/text-exhibits/thumbnail.png";
  if (variant === "video") return <section className={styles.bubble} data-video-exhibit={presentation} aria-label={copy.available} aria-live="polite">
    <div className={styles.bubbleHeader}><span className={styles.bubbleKind}>{copy.types[node.type]}</span>{presentation === "inline" && onDismiss && <button type="button" className={styles.close} aria-label={getMessages(locale).learning.close} onClick={onDismiss}><Image src="/portal/exhibit-prompt/close.svg" alt="" width={16} height={16}/></button>}</div>
    <Image className={styles.bubbleThumbnail} src={thumbnail} unoptimized width={140} height={140} alt=""/>
    <h2 className={styles.bubbleTitle}>{node.title || copy.untitled}</h2>
    <div className={styles.bubbleActions}><button type="button" className={styles.bubbleView} onClick={onView}>{copy.view} <span aria-hidden="true">→</span></button>{onDismiss && <button type="button" className={styles.bubbleDismiss} onClick={onDismiss}>{copy.notNow}</button>}</div>
    {presentation === "inline" && <Image className={styles.pointer} data-exhibit-pointer src="/portal/exhibit-prompt/pointer.svg" width={20} height={10} alt=""/>}
  </section>;
  const thumbnailSize = 104;
  return <section className={`${styles.bar} ${styles.text}`} aria-label={copy.available} aria-live="polite">
    <Image className={styles.thumbnail} src={thumbnail} unoptimized width={thumbnailSize} height={thumbnailSize} alt=""/>
    <div className={styles.copy}><div className={styles.metadata}><span className={styles.kind}>{copy.types[node.type]}</span></div><h2>{node.title || copy.untitled}</h2></div>
    <button type="button" className={styles.view} onClick={onView}>{copy.view}<span aria-hidden="true">→</span></button>
  </section>;
}
