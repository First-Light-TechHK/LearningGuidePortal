import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { BackofficeShell } from "@/components/portal/BackofficeShell";
import { menuForBackofficePath } from "@/lib/backofficeRbac";
import { localeFrom } from "@/lib/i18n/config";
import { canUseBackofficeMenu } from "@/services/backofficeAccess";
import { backofficeShellProps } from "@/services/backofficeShell";
import { currentBackofficeAuthor, currentOperatorUser, isCurrentAdminHost } from "@/services/productAuth";

export async function KnowledgeAdminBoundary({ children }: { children: React.ReactNode }) {
  if (!(await isCurrentAdminHost())) return <>{children}</>;
  const operator = await currentOperatorUser();
  if (!operator) {
    if (await currentBackofficeAuthor()) notFound();
    redirect("/en-GB/backoffice/sign-in");
  }
  // Knowledge and AI Tutor are hidden and blocked for roles without the menu (PRD §3.3).
  const pathname = (await headers()).get("x-lg-pathname") || "";
  const menu = menuForBackofficePath(pathname) || "knowledge";
  if (!canUseBackofficeMenu(operator, menu)) notFound();
  const locale = localeFrom(operator.locale);
  const shell = backofficeShellProps(operator, locale);
  return (
    <BackofficeShell locale={locale} menus={shell.menus} user={shell.user}>
      {children}
    </BackofficeShell>
  );
}
