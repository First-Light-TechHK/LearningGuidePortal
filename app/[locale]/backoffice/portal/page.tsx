import { redirect } from "next/navigation";
import { currentOperatorUser } from "@/services/productAuth";
import { getPortalContent } from "@/services/productStore";
import { localeFrom } from "@/lib/i18n/config";
import { PortalContentEditor } from "@/components/portal/PortalContentEditor";

export default async function PortalEditorPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  if (!await currentOperatorUser()) redirect(`/${locale}/backoffice/sign-in`);
  return <PortalContentEditor initial={await getPortalContent()} locale={locale} />;
}
