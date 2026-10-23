import { BackofficePlaceholder, BackofficeSettingsFrame } from "@/components/portal/BackofficeSettingsFrame";
import { getBackofficeShellMessages } from "@/lib/i18n/backofficeShellMessages";
import { localeFrom } from "@/lib/i18n/config";
import { canManageBackofficeEmployees } from "@/services/backofficeAccess";
import { requireBackofficeMenu } from "@/services/productAuth";

// PRD §2.3: Notification Configuration is a placeholder in P0.
export default async function BackofficeNotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await requireBackofficeMenu(locale, "settings");
  const copy = getBackofficeShellMessages(locale).placeholders;
  return (
    <BackofficeSettingsFrame locale={locale} active="notifications" manageEmployees={canManageBackofficeEmployees(user)}>
      <BackofficePlaceholder title={copy.notifications.title} subtitle={copy.notifications.subtitle} note={copy.comingSoon} />
    </BackofficeSettingsFrame>
  );
}
