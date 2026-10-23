import { requireBackofficeMenu, requireBackofficeOperator } from "@/services/productAuth";
import { getPortalContent } from "@/services/productStore";
import { localeFrom } from "@/lib/i18n/config";
import { PortalContentEditor } from "@/components/portal/PortalContentEditor";
import { BackofficeSettingsFrame } from "@/components/portal/BackofficeSettingsFrame";
import { canManageBackofficeEmployees } from "@/services/backofficeAccess";

export default async function PortalEditorPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  await requireBackofficeMenu(locale, "settings");
  const user = await requireBackofficeOperator(locale);
  return (
    <BackofficeSettingsFrame locale={locale} active="portalContent" manageEmployees={canManageBackofficeEmployees(user)}>
      <PortalContentEditor initial={await getPortalContent()} locale={locale} />
    </BackofficeSettingsFrame>
  );
}
