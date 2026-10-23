import { BackofficePlaceholder, BackofficeSettingsFrame } from "@/components/portal/BackofficeSettingsFrame";
import { getBackofficeShellMessages } from "@/lib/i18n/backofficeShellMessages";
import { localeFrom } from "@/lib/i18n/config";
import { requireBackofficeEmployeeAdmin } from "@/services/productAuth";

// Settings -> Employee Account (Admin only). The list and forms come with the Settings module.
export default async function BackofficeEmployeesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  await requireBackofficeEmployeeAdmin(locale);
  const copy = getBackofficeShellMessages(locale).placeholders;
  return (
    <BackofficeSettingsFrame locale={locale} active="employees" manageEmployees>
      <BackofficePlaceholder title={copy.employees.title} subtitle={copy.employees.subtitle} note={copy.comingSoon} />
    </BackofficeSettingsFrame>
  );
}
