"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import type { Banner } from "@/lib/portalContent";
import { getMessages } from "@/lib/i18n/messages";

export function BannerSlides({ locale, items, home = false }: { locale: Locale; items: Banner[]; home?: boolean }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const copy = getMessages(locale).homeDesign;
  useEffect(() => {
    if (items.length < 2 || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % items.length), 3000);
    return () => window.clearInterval(timer);
  }, [items.length, paused]);
  if (!items.length) return null;
  const current = items[active % items.length];
  const destination = active < 2 ? `/${locale}/portal/courses` : current.href;
  const previous = () => setActive((value) => (value - 1 + items.length) % items.length);
  const next = () => setActive((value) => (value + 1) % items.length);
  return <section className="portal-banner" aria-label={copy.carousel} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    <div className="portal-banner-image" data-slide={active % items.length} style={{ backgroundImage: home ? `url(${current.image})` : `linear-gradient(90deg, rgba(10, 26, 50, .78), rgba(10, 26, 50, .18)), url(${current.image})` }} />
    <div className="portal-banner-content">{!home && current.eyebrow ? <p className="portal-eyebrow">{current.eyebrow}</p> : null}<h1>{current.title}</h1><p>{current.text}</p><Link prefetch={false} className={`portal-button${home ? "" : " portal-button-primary"}`} href={destination}>{current.cta}{home ? <span aria-hidden="true"> →</span> : null}</Link></div>
    <div className="portal-banner-controls">{!home ? <button className="portal-banner-arrow" type="button" onClick={previous} aria-label={copy.previous}><ChevronLeft size={18} aria-hidden="true" /></button> : null}<div className="portal-banner-dots" aria-label={copy.selection}>{items.map((item, index) => <button key={`${item.title}-${index}`} className={index === active ? "active" : ""} type="button" aria-label={`${copy.slide} ${index + 1}`} aria-pressed={index === active} onClick={() => setActive(index)} />)}</div>{!home ? <button className="portal-banner-arrow" type="button" onClick={next} aria-label={copy.next}><ChevronRight size={18} aria-hidden="true" /></button> : null}</div>
  </section>;
}
