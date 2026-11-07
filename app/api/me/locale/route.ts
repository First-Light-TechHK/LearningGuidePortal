import { NextResponse } from "next/server";
import { isLocale } from "@/lib/i18n/config";
import { currentProductUser } from "@/services/productAuth";
import { setUserLocale } from "@/services/productStore";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });
  const body = await request.json().catch(() => null) as { locale?: unknown } | null;
  const locale = typeof body?.locale === "string" ? body.locale : "";
  if (!isLocale(locale)) return NextResponse.json({ ok: false, code: "invalid_locale" }, { status: 400 });
  if (user.locale !== locale) await setUserLocale(user.id, locale);
  return NextResponse.json({ ok: true, locale });
}
