import { redirect } from "next/navigation";
import { localeFrom } from "@/lib/i18n/config";

/** Older link to the account help page: straight to the public Help Centre. */
export default async function HelpAlias({ params }: { params: Promise<{ locale: string }> }) {
  redirect(`/${localeFrom((await params).locale)}/help`);
}
