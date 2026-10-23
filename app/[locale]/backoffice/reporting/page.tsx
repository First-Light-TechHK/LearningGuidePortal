import { BackofficePlaceholder } from "@/components/portal/BackofficeSettingsFrame";
import { getBackofficeShellMessages } from "@/lib/i18n/backofficeShellMessages";
import { localeFrom } from "@/lib/i18n/config";
import { requireBackofficeMenu } from "@/services/productAuth";

// Menu is open; the module itself follows its own PRD.
export default async function BackofficeReportingPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  await requireBackofficeMenu(locale, "reporting");
  const copy = getBackofficeShellMessages(locale).placeholders;
  return <BackofficePlaceholder title={copy.reporting.title} subtitle={copy.reporting.subtitle} note={copy.comingSoon} />;
}
