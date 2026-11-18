"use client";
import Link from "next/link";
import { Headset } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getMessages } from "@/lib/i18n/messages";

export function AccountNav({ locale, copy }: { locale: "en-GB" | "zh-CN"; copy: { overview: string; subscription: string; notifications: string; settings: string; help: string } }) {
  const pathname = usePathname();
  const support = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const card = support.current;
    if (!card) return;
    const measure = () => card.style.setProperty("--account-support-height", `${Math.ceil(card.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  const labels = getMessages(locale).account;
  const root = `/${locale}/account/my-learning`;
  const links = [[root, copy.overview], [`${root}/subscription`, copy.subscription], [`${root}/notifications`, copy.notifications], [`${root}/settings`, copy.settings]];
  return <nav className="account-nav" aria-label={labels.menu}><p className="account-nav-title"></p>{links.map(([href, label]) => <Link prefetch={false} key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}<div className="account-nav-support-slot"><div ref={support} className="account-nav-support"><span className="account-nav-support-icon" role="img" aria-label={labels.contact}><Headset size={22} aria-hidden="true"/></span><p>{labels.supportDescription}</p><Link prefetch={false} href={`/${locale}/account/my-learning/support`}>{labels.contactAction}</Link></div></div></nav>;
}
