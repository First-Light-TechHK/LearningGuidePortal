"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n/config";

type Banner = { image: string; eyebrow: string; title: string; text: string; cta: string; href: string };

const banners: Record<Locale, Banner[]> = {
  "en-GB": [
    { image: "/portal/auth-library.jpg", eyebrow: "LEARNING GUIDE", title: "Courses that give thinking room", text: "Study humanities and science through clear material, conversation and practice.", cta: "Explore courses", href: "/en-GB/portal/courses" },
    { image: "/portal/course-book.jpg", eyebrow: "START WITH A LESSON", title: "Begin with the public lesson", text: "See how each course is organised before you decide what to study next.", cta: "View courses", href: "/en-GB/portal/courses" },
    { image: "/portal/course-study.jpg", eyebrow: "MY LEARNING", title: "Keep your learning together", text: "Return to your lessons and continue with the course-aligned AI Tutor.", cta: "Go to My Learning", href: "/en-GB/account/my-learning" },
  ],
  "zh-CN": [
    { image: "/portal/auth-library.jpg", eyebrow: "LEARNING GUIDE", title: "给思考留下空间的课程", text: "通过清晰的材料、对话和练习学习人文与科学。", cta: "浏览课程", href: "/zh-CN/portal/courses" },
    { image: "/portal/course-book.jpg", eyebrow: "从一节课开始", title: "先阅读公开首课", text: "在决定下一步学习什么之前，先了解课程如何组织。", cta: "查看课程", href: "/zh-CN/portal/courses" },
    { image: "/portal/course-study.jpg", eyebrow: "MY LEARNING", title: "把学习记录放在一起", text: "回到课程内容，继续使用与课程一致的 AI Tutor。", cta: "进入 My Learning", href: "/zh-CN/account/my-learning" },
  ],
};

export function BannerCarousel({ locale }: { locale: Locale }) {
  const items = banners[locale];
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setActive((value) => (value + 1) % items.length), 3000);
    return () => window.clearInterval(timer);
  }, [items.length]);
  const current = items[active];
  return <section className="portal-banner" aria-label="Featured learning"><div className="portal-banner-image" style={{ backgroundImage: `linear-gradient(90deg, rgba(10, 26, 50, .78), rgba(10, 26, 50, .18)), url(${current.image})` }} /><div className="portal-banner-content"><p className="portal-eyebrow">{current.eyebrow}</p><h1>{current.title}</h1><p>{current.text}</p><Link className="portal-button portal-button-primary" href={current.href}>{current.cta}</Link></div><div className="portal-banner-dots" aria-label="Banner selection">{items.map((item, index) => <button key={item.title} className={index === active ? "active" : ""} type="button" aria-label={`Banner ${index + 1}`} aria-pressed={index === active} onClick={() => setActive(index)} />)}</div></section>;
}
