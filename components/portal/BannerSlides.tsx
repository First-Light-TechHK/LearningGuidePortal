"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import type { Banner } from "@/lib/portalContent";

export function BannerSlides({ locale, items }: { locale: Locale; items: Banner[] }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setActive((value) => (value + 1) % items.length), 3000);
    return () => window.clearInterval(timer);
  }, [items.length]);
  const current = items[active];
  const previous = () => setActive((value) => (value - 1 + items.length) % items.length);
  const next = () => setActive((value) => (value + 1) % items.length);
  return <section className="portal-banner" aria-label="Featured learning"><div className="portal-banner-image" style={{ backgroundImage: `linear-gradient(90deg, rgba(10, 26, 50, .78), rgba(10, 26, 50, .18)), url(${current.image})` }} /><div className="portal-banner-content"><p className="portal-eyebrow">{current.eyebrow}</p><h1>{current.title}</h1><p>{current.text}</p><Link prefetch={false} className="portal-button portal-button-primary" href={current.href}>{current.cta}</Link></div><div className="portal-banner-controls"><button className="portal-banner-arrow" type="button" onClick={previous} aria-label="Previous banner"><ChevronLeft size={18} aria-hidden="true" /></button><div className="portal-banner-dots" aria-label="Banner selection">{items.map((item, index) => <button key={item.title} className={index === active ? "active" : ""} type="button" aria-label={`Banner ${index + 1}`} aria-pressed={index === active} onClick={() => setActive(index)} />)}</div><button className="portal-banner-arrow" type="button" onClick={next} aria-label="Next banner"><ChevronRight size={18} aria-hidden="true" /></button></div></section>;
}
