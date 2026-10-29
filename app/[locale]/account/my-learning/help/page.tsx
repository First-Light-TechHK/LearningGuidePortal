import { redirect } from "next/navigation";
import { localeFrom } from "@/lib/i18n/config";

/** The account Help Center / FAQ is the public Help Centre now (tickets-v2-figma-addendum §4d). */
export default async function AccountHelpRedirect({ params }: { params: Promise<{ locale: string }> }) {
  redirect(`/${localeFrom((await params).locale)}/help`);
}
