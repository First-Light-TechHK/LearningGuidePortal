import { redirect } from "next/navigation";
import { localeFrom } from "@/lib/i18n/config";
import { backofficeIntegrationUrl } from "@/services/backofficeIntegrations";
import { requireBackofficeMenu } from "@/services/productAuth";

export const dynamic = "force-dynamic";

// Menu entry for the separately owned AiTutor front end; access is checked here first.
export default async function BackofficeAiTutorPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  await requireBackofficeMenu(locale, "aiTutor");
  redirect(backofficeIntegrationUrl("aiTutor"));
}
