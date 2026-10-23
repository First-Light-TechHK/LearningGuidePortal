import type { ReactNode } from "react";
import { BackofficeShell } from "@/components/portal/BackofficeShell";
import { localeFrom } from "@/lib/i18n/config";
import { currentBackofficeAuthor } from "@/services/productAuth";
import { backofficeShellProps } from "@/services/backofficeShell";

export default async function BackofficeLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentBackofficeAuthor();
  if (!user) return children;
  const shell = backofficeShellProps(user, locale);
  return (
    <BackofficeShell locale={locale} menus={shell.menus} user={shell.user}>
      {children}
    </BackofficeShell>
  );
}
