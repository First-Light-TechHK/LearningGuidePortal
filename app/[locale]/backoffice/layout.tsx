import type { ReactNode } from "react";
import { BackofficeShell } from "@/components/portal/BackofficeShell";
import { localeFrom } from "@/lib/i18n/config";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import { currentBackofficeAuthor } from "@/services/productAuth";
import { isOperator } from "@/services/productStore";

export default async function BackofficeLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentBackofficeAuthor();
  if (!user) return children;
  const copy = getCourseManagementMessages(locale);
  return (
    <BackofficeShell
      locale={locale}
      operator={isOperator(user)}
      user={{ nickname: user.nickname, email: user.email, role: isOperator(user) ? copy.operator : copy.teacher }}
    >
      {children}
    </BackofficeShell>
  );
}
