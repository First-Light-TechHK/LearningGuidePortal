import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { getPortalContent, isOperator } from "@/services/productStore";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { PortalContentEditor } from "@/components/portal/PortalContentEditor";

export default async function PortalEditorPage({ params }: { params: Promise<{ locale: string }> }) {
 const locale = localeFrom((await params).locale);
 const user = await currentProductUser();
 if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/backoffice/portal`);
 if (!isOperator(user)) redirect(`/${locale}/portal`);
 return <main className="portal-page portal-page-narrow"><Link href={`/${locale}/backoffice/courses`}>{getMessages(locale).portal.navigation.courses}</Link><PortalContentEditor initial={await getPortalContent()} locale={locale} /></main>;
}
