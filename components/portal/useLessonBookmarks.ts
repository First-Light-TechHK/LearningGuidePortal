"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { LessonBookmark, LessonBookmarkInput, LessonBookmarkSnapshot, LessonBookmarkRestore } from "@/contracts/lesson-bookmark";
import { lessonLanguageSaveEvent, type LessonLanguageSave } from "@/lib/lessonLanguageNavigation";
import type { LessonContent } from "@/contracts/lesson-content";
import { bookmarkLessonRevision } from "@/lib/lessonBookmarkDisplay";
import { createClientEventId } from "@/lib/clientEventId";

type Position = Pick<LessonBookmarkInput, "contentId" | "positionMs" | "paragraphId">;
const blocks = "p,h1,h2,h3,h4,h5,h6,li,blockquote";

/** Reading position is independent of completion. Preview never activates this hook. */
export function useLessonBookmarks({ root, courseId, lessonId, mode, enabled, ownerId, initial, contents, onRestoreContent, restorePolicy = "position" }: {
  root: RefObject<HTMLDivElement | null>; courseId: string; lessonId: string; mode: "video" | "text";
  enabled: boolean; ownerId?: string; initial?: LessonBookmarkSnapshot; contents: LessonContent[];
  onRestoreContent: (id: string) => void;
  restorePolicy?: LessonBookmarkRestore;
}) {
  const [bookmarks, setBookmarks] = useState(initial?.bookmarks || {});
  const [error, setError] = useState(false), [reloadRequired, setReloadRequired] = useState(false);
  const snapshot = useRef(initial), mounted = useRef(true);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const restoreContent = useRef(onRestoreContent);
  restoreContent.current = onRestoreContent;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const version = snapshot.current?.versions[lessonId]?.[mode];
    const surface = root.current;
    if (!enabled || !ownerId || !version || !surface) return;
    const key = `learning-guide:bookmark:${ownerId}:${courseId}:${lessonId}:${mode}`;
    let active = true, blocked = false, dirty = false;
    let latest: Position | undefined, inFlight: Promise<void> | undefined, pending: LessonBookmarkInput | undefined;
    let restore: Position | undefined;
    const server = snapshot.current?.bookmarks[lessonId]?.[mode];
    if (restorePolicy !== "start" && server?.contentVersion === version) restore = server;
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) || "null") as { request: LessonBookmarkInput; latest?: Position } | null;
      const value = stored?.request;
      if (restorePolicy !== "start" && stored && value?.courseId === courseId && value.lessonId === lessonId && value.mode === mode && value.contentVersion === version) {
        const revision = bookmarkLessonRevision(snapshot.current!.bookmarks, lessonId);
        const newer = stored.latest && (stored.latest.contentId !== value.contentId || stored.latest.positionMs !== value.positionMs || stored.latest.paragraphId !== value.paragraphId);
        if (value.expectedRevision === (server?.revision || 0) && value.expectedLessonRevision === revision) {
          pending = value; latest = stored.latest || value; restore = latest; dirty = Boolean(newer);
        } else if (server?.clientEventId === value.clientEventId && newer && revision === value.expectedLessonRevision + 1) {
          latest = stored.latest; restore = latest; dirty = true;
        } else sessionStorage.removeItem(key);
      } else sessionStorage.removeItem(key);
    } catch { /* Storage may be disabled; server checkpoints still work. */ }
    if (restore?.contentId) restoreContent.current(restore.contentId);
    const same = (a: Position | undefined, b: Position | undefined) => a?.contentId === b?.contentId && a?.positionMs === b?.positionMs && a?.paragraphId === b?.paragraphId;
    const remember = () => { if (pending) try { sessionStorage.setItem(key, JSON.stringify({ request: pending, latest })); } catch { /* Optional recovery cache. */ } };
    const capture = (position: Position) => { if (!same(latest, position)) { latest = position; dirty = true; } };
    const flush = (): Promise<void> => {
      if (inFlight) { remember(); return inFlight.then(() => { if (!blocked && dirty) return flush(); }); }
      if (blocked || !pending && (!dirty || !latest)) return Promise.resolve();
      if (!pending) {
        const data = snapshot.current!;
        pending = { courseId, lessonId, mode, contentVersion: version, ...latest!, expectedRevision: data.bookmarks[lessonId]?.[mode]?.revision || 0,
          expectedLessonRevision: bookmarkLessonRevision(data.bookmarks, lessonId), clientEventId: createClientEventId() };
        dirty = false;
      }
      remember();
      const request = pending;
      inFlight = (async () => {
        try {
          const response = await fetch("/api/study/bookmarks", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
          if (!response.ok) {
            if ([400, 401, 403, 409].includes(response.status)) { blocked = true; if (mounted.current) setReloadRequired(true); try { sessionStorage.removeItem(key); } catch {} }
            throw new Error("bookmark-save");
          }
          const result = await response.json() as { ok: boolean; data: LessonBookmark };
          if (!result.ok || result.data?.clientEventId !== request.clientEventId) throw new Error("bookmark-response");
          const next = { ...snapshot.current!.bookmarks, [lessonId]: { ...snapshot.current!.bookmarks[lessonId], [mode]: result.data } };
          snapshot.current = { ...snapshot.current!, bookmarks: next };
          pending = undefined;
          try { sessionStorage.removeItem(key); } catch {}
          if (mounted.current) { setBookmarks(next); setError(false); }
        } catch { if (mounted.current) setError(true); }
        finally { inFlight = undefined; }
      })();
      return inFlight;
    };

    let media: HTMLVideoElement | null = null, detachMedia: (() => void) | undefined;
    let sampleVideo: ((force?: boolean) => void) | undefined;
    let restored = false, restoring = false, textTimer: ReturnType<typeof setTimeout> | undefined;
    let restoreFrame = 0;
    const textPositions = () => {
      const reader = surface.querySelector<HTMLElement>("[data-text-reader]");
      if (!reader || reader.dataset.bookmarkReady !== "true") return [];
      const result: { element: HTMLElement; position: Position }[] = [];
      reader.querySelectorAll<HTMLElement>("[data-text-point-id]").forEach(point => {
        const id = point.dataset.textPointId || "body";
        const paragraphs = Array.from(point.querySelectorAll<HTMLElement>(`.la-prose :is(${blocks})`)).filter(element => !element.querySelector(blocks));
        (paragraphs.length ? paragraphs : [point]).forEach((element, index) => result.push({ element, position: {
          contentId: id === "body" ? null : id, paragraphId: `${id}:paragraph:${index}`,
        } }));
      });
      return result;
    };
    const sampleText = () => {
      if (!restored || restoring) return;
      const reader = surface.querySelector<HTMLElement>("[data-text-reader]");
      if (!reader) return;
      const bounds = reader.getBoundingClientRect();
      const header = document.querySelector<HTMLElement>(".portal-header")?.getBoundingClientRect();
      const top = Math.max(0, bounds.top, header && header.top <= 0 ? header.bottom : 0);
      const bottom = Math.min(innerHeight, bounds.bottom);
      if (bottom <= top) return;
      const entry = textPositions().find(({ element }) => { const rect = element.getBoundingClientRect(); return rect.height > 0 && rect.bottom > top && rect.top < bottom; });
      if (entry) capture(entry.position);
    };
    const scan = () => {
      if (!active) return;
      if (mode === "text") {
        if (restored) return;
        const entries = textPositions();
        if (!entries.length) return;
        restoring = true;
        // Let the reader's initial LP navigation finish before restoring its paragraph.
        cancelAnimationFrame(restoreFrame);
        restoreFrame = requestAnimationFrame(() => { restoreFrame = requestAnimationFrame(() => {
          if (!active) return;
          const target = restorePolicy === "lp" ? surface.querySelector<HTMLElement>("[data-text-reader]")?.querySelector<HTMLElement>(`[data-text-point-id="${CSS.escape(restore?.contentId || "body")}"]`)
            : entries.find(entry => entry.position.paragraphId === restore?.paragraphId)?.element;
          const reader = surface.querySelector<HTMLElement>("[data-text-reader]");
          if (target && reader) {
            const header = document.querySelector<HTMLElement>(".portal-header");
            const headerTop = header && getComputedStyle(header).position === "fixed" ? header.getBoundingClientRect().bottom : 0;
            if (getComputedStyle(reader).overflowY === "visible") window.scrollBy(0, target.getBoundingClientRect().top - headerTop - 12);
            else reader.scrollTop += target.getBoundingClientRect().top - reader.getBoundingClientRect().top - 12;
          }
          restored = true; restoring = false;
          sampleText(); void flush();
        }); });
        return;
      }
      const next = surface.querySelector<HTMLVideoElement>("video.la-lesson-video");
      if (next === media) return;
      if (media) { sampleVideo?.(); void flush(); detachMedia?.(); }
      media = next;
      if (!media) return;
      const element = media;
      let used = false, timer: ReturnType<typeof setInterval> | undefined;
      const sample = (force?: boolean | Event) => {
        if ((!used && force !== true) || restoring || element.seeking || !Number.isFinite(element.currentTime) || element.currentTime < 0) return;
        const contentId = element.dataset.bookmarkContentId;
        if (contentId) capture({ contentId, positionMs: Math.round(element.currentTime * 1000) });
      };
      sampleVideo = sample;
      const interaction = (event: Event) => { if (event.target instanceof Element && event.target.closest(".la-controlled-video, [data-reading-outline] button")) used = true; };
      surface.addEventListener("pointerdown", interaction, true); surface.addEventListener("keydown", interaction, true);
      const stop = () => { clearInterval(timer); timer = undefined; };
      const play = () => { used = true; stop(); timer = setInterval(() => { if (!element.paused && !element.seeking && element.readyState >= 3) { sample(); void flush(); } }, 30_000); };
      const save = () => { sample(); void flush(); };
      const pause = () => { stop(); save(); };
      const seeked = () => { if (restoring || !used) return; save(); };
      const ready = () => {
        if (restored || !Number.isFinite(element.duration) || element.duration <= 0) return;
        restored = true;
        if (restorePolicy === "start") element.currentTime = 0;
        if (restore?.positionMs !== undefined) {
          restoring = true;
          element.currentTime = Math.min(restore.positionMs / 1000, element.duration);
          latest = { contentId: element.dataset.bookmarkContentId || restore.contentId, positionMs: Math.round(element.currentTime * 1000) };
          used = true; dirty = true;
          requestAnimationFrame(() => { restoring = false; });
        }
      };
      element.addEventListener("loadedmetadata", ready);
      element.addEventListener("playing", play); element.addEventListener("waiting", stop);
      element.addEventListener("pause", pause); element.addEventListener("seeked", seeked);
      element.addEventListener("timeupdate", sample); element.addEventListener("ended", pause);
      if (element.readyState >= 1) ready();
      detachMedia = () => {
        stop(); surface.removeEventListener("pointerdown", interaction, true); surface.removeEventListener("keydown", interaction, true); element.removeEventListener("loadedmetadata", ready); element.removeEventListener("playing", play);
        element.removeEventListener("waiting", stop); element.removeEventListener("pause", pause);
        element.removeEventListener("seeked", seeked); element.removeEventListener("timeupdate", sample); element.removeEventListener("ended", pause);
      };
    };
    const sampleAndFlush = (force = false) => { if (mode === "text") sampleText(); else sampleVideo?.(force); return flush(); };
    flushRef.current = sampleAndFlush;
    const scroll = () => { if (mode !== "text") return; sampleText(); clearTimeout(textTimer); textTimer = setTimeout(() => void flush(), 800); };
    const visibility = () => { if (document.visibilityState === "hidden") void sampleAndFlush(); };
    const leave = () => { void sampleAndFlush(); };
    const online = () => { void flush(); };
    const language = (event: Event) => {
      const detail = (event as CustomEvent<LessonLanguageSave>).detail;
      detail.setMode(mode); detail.waitUntil(sampleAndFlush(true));
    };
    const observer = new MutationObserver(scan);
    observer.observe(surface, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-bookmark-ready"] });
    scan(); if (pending || dirty) void flush();
    window.addEventListener("scroll", scroll, true); window.addEventListener("pagehide", leave);
    window.addEventListener("online", online); document.addEventListener("visibilitychange", visibility);
    window.addEventListener(lessonLanguageSaveEvent, language);
    return () => {
      void sampleAndFlush(); active = false; observer.disconnect(); detachMedia?.(); clearTimeout(textTimer); cancelAnimationFrame(restoreFrame);
      window.removeEventListener("scroll", scroll, true); window.removeEventListener("pagehide", leave);
      window.removeEventListener("online", online); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener(lessonLanguageSaveEvent, language);
    };
  }, [courseId, lessonId, mode, enabled, ownerId, root, restorePolicy]);

  const flush = useCallback(() => flushRef.current(), []);
  return { bookmarks, error, reloadRequired, flush };
}
