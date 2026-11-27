"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import styles from "./reading-navigation.module.css";

export function ReadingNavigation({ root, locale, courseHref, beforeNavigate }: {
  root: RefObject<HTMLDivElement | null>; locale: Locale; courseHref: string;
  beforeNavigate?: () => Promise<void>;
}) {
  const copy = getMessages(locale).readingNavigation;
  const bar = useRef<HTMLElement>(null);
  const save = useRef(beforeNavigate), navigating = useRef(false), mounted = useRef(true);
  const destination = useRef<string | null>(null);
  save.current = beforeNavigate;
  const [visible, setVisible] = useState(false), [busy, setBusy] = useState(false), [failedHref, setFailedHref] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const page = root.current, element = bar.current, breadcrumb = page?.querySelector("[data-lesson-breadcrumb]");
    if (!page || !element || !breadcrumb) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const shown = breadcrumb.getBoundingClientRect().bottom <= 0 || busy || Boolean(failedHref);
      const height = Math.ceil(element.getBoundingClientRect().height);
      page.style.setProperty("--reading-toolbar-height", `${height}px`);
      const inset = `${shown ? height : 0}px`;
      if (page.style.getPropertyValue("--reading-top-inset") !== inset) {
        const outline = page.querySelector<HTMLElement>("[data-reading-outline] nav");
        const atBottom = Boolean(outline && outline.scrollHeight > outline.clientHeight &&
          outline.scrollTop > 0 && outline.scrollTop >= outline.scrollHeight - outline.clientHeight - 1);
        page.style.setProperty("--reading-top-inset", inset);
        // Preserve the user's position at the end when the toolbar changes the available height.
        if (outline && atBottom) outline.scrollTop = outline.scrollHeight;
      }
      setVisible(shown);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(element); observer.observe(breadcrumb);
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      page.style.removeProperty("--reading-toolbar-height"); page.style.removeProperty("--reading-top-inset");
    };
  }, [root, busy, failedHref]);


  async function navigate(href: string) {
    if (navigating.current) return;
    navigating.current = true; destination.current = href; setBusy(true); setFailedHref(null);
    try {
      await save.current?.();
      if (mounted.current) window.location.assign(href);
    } catch {
      navigating.current = false;
      if (mounted.current) { setFailedHref(href); setBusy(false); }
    }
  }
  const navigateRef = useRef(navigate); navigateRef.current = navigate;
  useEffect(() => {
    const follow = (event: MouseEvent) => {
      if (!save.current) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || anchor.target && anchor.target !== "_self") return;
      if (!anchor.closest(".portal-header") && !root.current?.contains(anchor)) return;
      if (!anchor.closest(".portal-header,[data-lesson-breadcrumb],[data-reading-toolbar],[data-reading-tools]")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === location.pathname && destination.search === location.search && destination.hash) return;
      event.preventDefault();
      void navigateRef.current(destination.href);
    };
    document.addEventListener("click", follow, true);
    return () => document.removeEventListener("click", follow, true);
  }, [root]);

  return <>
    <nav ref={bar} className={styles.bar} data-reading-toolbar data-visible={visible} aria-label={copy.label} aria-hidden={!visible} inert={!visible} aria-busy={busy}>
      <div className={styles.row}>
        <Link prefetch={false} className={styles.back} href={courseHref}><ArrowLeft size={16} aria-hidden="true"/>{copy.backToCourse}</Link>
        <Link prefetch={false} href={`/${locale}/account/my-learning`}>{copy.myLearning}</Link>
      </div>
      {busy && <div className={styles.feedback}><span role="status">{copy.saving}</span><button type="button" onClick={() => { if (destination.current) window.location.assign(destination.current); }}>{copy.leave}</button></div>}
      {failedHref && <div className={styles.feedback} role="alert"><span>{copy.saveError}</span><button type="button" onClick={() => void navigate(failedHref)}>{copy.retry}</button><button type="button" onClick={() => window.location.assign(failedHref)}>{copy.leave}</button><button type="button" onClick={() => setFailedHref(null)}>{copy.stay}</button></div>}
    </nav>
  </>;
}
