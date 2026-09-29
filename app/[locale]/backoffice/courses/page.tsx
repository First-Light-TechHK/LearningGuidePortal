import { redirect } from "next/navigation";
import { CourseManager } from "@/components/portal/CourseManager";
import { getMessages } from "@/lib/i18n/messages";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import { localeFrom } from "@/lib/i18n/config";
import { currentBackofficeAuthor } from "@/services/productAuth";
import { isOperator } from "@/services/productStore";
import { canAuthorCourses } from "@/services/backofficeAccess";

export default async function BackofficeCoursesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  const copy = getCourseManagementMessages(locale);
  const user = await currentBackofficeAuthor();
  if (!user) redirect(`/${locale}/backoffice/sign-in`);
  if (!canAuthorCourses(user)) {
    return (
      <section className="backoffice-panel">
        <p className="portal-eyebrow">{messages.backoffice.title}</p>
        <h1>{messages.backoffice.restricted}</h1>
        <p className="portal-lead">{copy.errors.restricted}</p>
      </section>
    );
  }
  return <CourseManager locale={locale} operator={isOperator(user)} copy={messages.backoffice} />;
}
