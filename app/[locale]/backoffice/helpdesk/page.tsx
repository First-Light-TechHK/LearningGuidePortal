import { BackofficePlaceholder } from "@/components/portal/BackofficeSettingsFrame";
import { getBackofficeShellMessages } from "@/lib/i18n/backofficeShellMessages";
import { localeFrom } from "@/lib/i18n/config";
import { requireBackofficeMenu } from "@/services/productAuth";

// Menu is open; the module itself follows its own PRD.
export default async function BackofficeHelpdeskPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  await requireBackofficeMenu(locale, "helpdesk");
  const copy = getBackofficeShellMessages(locale).placeholders;
  return <BackofficePlaceholder title={copy.helpdesk.title} subtitle={copy.helpdesk.subtitle} note={copy.comingSoon} />;
}
