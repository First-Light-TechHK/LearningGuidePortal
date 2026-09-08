import { secureAuthCookie } from "@/services/runtimeConfig";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { deleteSession } from "@/services/productStore";
import { SESSION_COOKIE } from "@/services/productAuth";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  await deleteSession(cookieStore.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: 0 });
  return response;
}
