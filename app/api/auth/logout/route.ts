import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { deleteSession } from "@/services/productStore";
import { SESSION_COOKIE } from "@/services/productAuth";

export async function POST() {
  const cookieStore = await cookies();
  await deleteSession(cookieStore.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
