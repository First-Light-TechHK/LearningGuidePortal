"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { authNavigationHref } from "@/lib/authNavigation";

export function AuthNavigationLink({ locale, mode = "sign-in", className, children }: {
  locale: string; mode?: "sign-in" | "sign-up"; className?: string; children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [href, setHref] = useState(`/${locale}/portal/${mode}`);
  useEffect(() => {
    const update = () => setHref(authNavigationHref(locale, mode, window.location.href));
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, [locale, mode, pathname, searchParams]);
  return <a className={className} href={href} onClick={event => {
    event.currentTarget.href = authNavigationHref(locale, mode, window.location.href);
  }}>{children}</a>;
}
