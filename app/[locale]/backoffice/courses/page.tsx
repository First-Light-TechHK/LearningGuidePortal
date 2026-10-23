import { CourseManager } from "@/components/portal/CourseManager";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { requireBackofficeMenu } from "@/services/productAuth";
import { isOperator } from "@/services/productStore";

export default async function BackofficeCoursesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  const user = await requireBackofficeMenu(locale, "course");
  return <CourseManager locale={locale} operator={isOperator(user)} copy={messages.backoffice} />;
}
