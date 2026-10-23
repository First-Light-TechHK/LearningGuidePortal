import { redirect } from "next/navigation";
import { localeFrom } from "@/lib/i18n/config";
import { backofficeSettingsItems } from "@/lib/backofficeNav";
import { canManageBackofficeEmployees } from "@/services/backofficeAccess";
import { requireBackofficeMenu } from "@/services/productAuth";

export default async function BackofficeSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await requireBackofficeMenu(locale, "settings");
  redirect(backofficeSettingsItems(locale, canManageBackofficeEmployees(user))[0].href);
}
