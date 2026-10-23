import { NextResponse } from "next/server";
import { requestOriginMatches } from "@/services/adminHost";
import { currentAuthorRequest } from "@/services/productAuth";
import { saveUserLocale } from "@/services/productStore";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

// PORT-NAV-006: the language choice is kept across sign-ins.
export async function POST(request: Request) {
  const user = await currentAuthorRequest(request);
  if (!user || !requestOriginMatches(request)) return NextResponse.json({ ok: false, code: "RESTRICTED" }, { status: user ? 403 : 401, headers: privateHeaders });
  try {
    const body = await request.json() as { locale?: unknown };
    if (body.locale !== "en-GB" && body.locale !== "zh-CN") return NextResponse.json({ ok: false, code: "INVALID" }, { status: 400, headers: privateHeaders });
    await saveUserLocale(user.id, body.locale);
    return NextResponse.json({ ok: true, locale: body.locale }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ ok: false, code: "FAILED" }, { status: 500, headers: privateHeaders });
  }
}
