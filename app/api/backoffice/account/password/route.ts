import { NextResponse } from "next/server";
import { ProfileError } from "@/contracts/profile";
import { requestOriginMatches } from "@/services/adminHost";
import { ADMIN_SESSION_COOKIE, currentAuthorRequest } from "@/services/productAuth";
import { changeUserPassword } from "@/services/productStore";
import { secureAuthCookie } from "@/services/runtimeConfig";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

// PORT-P08: a signed-in employee changes their own password; all sessions end.
export async function POST(request: Request) {
  const user = await currentAuthorRequest(request);
  if (!user || !requestOriginMatches(request)) return NextResponse.json({ ok: false, code: "RESTRICTED" }, { status: user ? 403 : 401, headers: privateHeaders });
  try {
    const body = await request.json() as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string") return NextResponse.json({ ok: false, code: "INVALID" }, { status: 400, headers: privateHeaders });
    await changeUserPassword(user.id, body.currentPassword, body.newPassword);
    const response = NextResponse.json({ ok: true }, { headers: privateHeaders });
    response.cookies.set(ADMIN_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    if (error instanceof ProfileError) return NextResponse.json({ ok: false, code: error.code }, { status: 400, headers: privateHeaders });
    return NextResponse.json({ ok: false, code: "FAILED" }, { status: error instanceof SyntaxError ? 400 : 500, headers: privateHeaders });
  }
}
