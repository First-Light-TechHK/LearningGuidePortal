import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getUserBySessionToken, type ProductUser } from "./productStore";

export const SESSION_COOKIE = "learning_guide_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export async function currentProductUser(): Promise<ProductUser | null> {
  const cookieStore = await cookies();
  return getUserBySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function currentProductUserFromRequest(request: Request): Promise<ProductUser | null> {
  const header = request.headers.get("cookie") ?? "";
  const token = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return getUserBySessionToken(token);
}

export async function rejectIfUnauthenticated(request: Request) {
  const user = await currentProductUserFromRequest(request);
  if (user) return null;
  return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
}
