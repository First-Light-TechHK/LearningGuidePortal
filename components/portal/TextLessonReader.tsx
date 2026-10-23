"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import type { LessonContent } from "@/contracts/lesson-content";
import type { TextLessonPreview } from "@/contracts/text-lesson-preview";
import type { Locale } from "@/lib/i18n/config";
import { LegacyLessonBody, LessonContentPlayer } from "./LessonContentPlayer";
import styles from "./text-lesson-reader.module.css";

function startsWithPointTitle(point: LessonContent, number: string) {
  const opening = point.html?.match(/^\s*<(p|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  const title = opening?.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return title === point.title.trim().toLowerCase() || title === `${number} ${point.title}`.trim().toLowerCase();
}

/** One persistent reading surface; selection follows its scroll position. */
export function TextLessonReader({ contents, body, locale, lessonNumber, initialContentId, navigationRequest, onContentChange, preview, previewEnd, className, label }: {
  contents: LessonContent[]; body: string; locale: Locale; lessonNumber: string;
  initialContentId: string; navigationRequest?: { id: string; request: number };
  onContentChange: (id: string) => void; preview?: TextLessonPreview; previewEnd?: ReactNode;
  className: string; label: string;
}) {
  const root = useRef<HTMLDivElement>(null), contentRoot = useRef<HTMLDivElement>(null), boundary = useRef<HTMLDivElement>(null);
  const prefix = useId(), active = useRef(initialContentId), onChange = useRef(onContentChange);
  const initialized = useRef(false), frame = useRef<number | null>(null);
  onChange.current = onContentChange;
  const points = contents.filter(point => point.active !== false && point.type !== "video");
  const readable = points.filter(point => preview?.points[point.id] !== "locked" && !(preview && point.type === "text" && !point.html?.trim()));
  const firstLocked = points.find(point => preview?.points[point.id] === "locked");

  function select(id: string) {
    if (id && active.current !== id) { active.current = id; onChange.current(id); }
  }
  function track() {
    const element = root.current;
    if (!element || !initialized.current) return;
    const sections = Array.from(element.querySelectorAll<HTMLElement>("[data-text-point-id]"));
    const top = element.getBoundingClientRect().top + element.clientTop + 32;
    let current: HTMLElement | undefined = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= top) current = section;
      else break;
    }
    if (element.scrollTop > 0 && element.scrollHeight - element.clientHeight - element.scrollTop < 2) current = sections.at(-1);
    if (current?.dataset.textPointId) select(current.dataset.textPointId);
  }
  function schedule() {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => { frame.current = null; track(); });
  }
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    if (contentRoot.current) observer.observe(contentRoot.current);
    return () => { observer.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  }, []);
  useEffect(() => {
    // Rich-text blocks are prepared after mount. Do not measure empty chapters.
    let frameId: number | undefined;
    const observer = new MutationObserver(prepare);
    function prepare() {
      const element = root.current, id = navigationRequest?.id || initialContentId;
      if (!element) return;
      const sections = Array.from(element.querySelectorAll<HTMLElement>("[data-text-point-id]"));
      if (readable.some(point => {
        const section = sections.find(section => section.dataset.textPointId === point.id);
        return point.type === "text" && (!section?.querySelector('[data-text-ready="true"]') || section.querySelector('.la-prose:not([data-text-ready="true"])'));
      })) return;
      observer.disconnect();
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const target = sections.find(section => section.dataset.textPointId === id) || (id ? boundary.current : null);
        initialized.current = true;
        element.scrollTo({ top: !target || target === sections[0] ? 0 : element.scrollTop + target.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientTop - 12, behavior: "auto" });
        select(id);
      });
    }
    if (contentRoot.current) observer.observe(contentRoot.current, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-text-ready"] });
    prepare();
    return () => { observer.disconnect(); if (frameId !== undefined) cancelAnimationFrame(frameId); };
  }, [navigationRequest, initialContentId]);

  return <div ref={root} className={className} tabIndex={0} aria-label={label} onScroll={schedule} onLoadCapture={schedule} data-text-reader>
    <div ref={contentRoot}>
      {readable.map(point => <section key={point.id} id={`${prefix}-${encodeURIComponent(point.id)}`} data-text-point-id={point.id} className={styles.point} aria-labelledby={`${prefix}-${encodeURIComponent(point.id)}-title`}>
        <h2 className={startsWithPointTitle(point, `${Number(lessonNumber)}.${points.indexOf(point) + 1}`) ? styles.sourceTitle : undefined} id={`${prefix}-${encodeURIComponent(point.id)}-title`}>{Number(lessonNumber)}.{points.indexOf(point) + 1} {point.title}</h2>
        <LessonContentPlayer contents={[point]} locale={locale} hideNavigation/>
      </section>)}
      {!points.length && body.trim() && <LegacyLessonBody body={body} locale={locale}/>}
      {previewEnd && <div ref={boundary} data-text-point-id={firstLocked?.id}>{previewEnd}</div>}
    </div>
  </div>;
}
