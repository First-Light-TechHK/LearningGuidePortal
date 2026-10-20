"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Locale } from "@/lib/i18n/config";
import { studyGroupSignInHref } from "./studyGroupClient";

// The header's Sign In comes back to this very page, the open group included
// (the Study Groups page keeps it in ?group=, QA M6).
export function StudyGroupSignInLink({ locale, className, label }: { locale: Locale; className: string; label: string }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  return <Link className={className} href={studyGroupSignInHref(locale, pathname + (query ? `?${query}` : ""))} prefetch={false}>{label}</Link>;
}
