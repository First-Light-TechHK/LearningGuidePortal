import { notFound, redirect } from "next/navigation";
import { BackofficeShell } from "@/components/portal/BackofficeShell";
import { localeFrom } from "@/lib/i18n/config";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import { currentBackofficeAuthor, currentOperatorUser, isCurrentAdminHost } from "@/services/productAuth";

export async function KnowledgeAdminBoundary({ children }: { children: React.ReactNode }) {
  if (!(await isCurrentAdminHost())) return <>{children}</>;
  const operator = await currentOperatorUser();
  if (!operator) {
    if (await currentBackofficeAuthor()) notFound();
    redirect("/en-GB/backoffice/sign-in");
  }
  const locale = localeFrom(operator.locale);
  const copy = getCourseManagementMessages(locale);
  return (
    <BackofficeShell
      locale={locale}
      operator
      user={{ nickname: operator.nickname, email: operator.email, role: copy.operator }}
    >
      {children}
    </BackofficeShell>
  );
}
