import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { adminHosts } from "./adminHost";
import { getUserBySessionToken, isOperator, type ProductUser } from "./productStore";

export const SESSION_COOKIE = "learning_guide_session";
export const ADMIN_SESSION_COOKIE = "learning_guide_admin_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

async function headerHostname() {
  const headerStore = await headers();
  const raw = headerStore.get("x-forwarded-host")?.split(",")[0].trim() || headerStore.get("host") || "";
  return raw.split(":")[0].toLowerCase();
}

export async function currentProductUser(): Promise<ProductUser | null> {
  const cookieStore = await cookies();
  return getUserBySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function currentOperatorUser(): Promise<ProductUser | null> {
  if (!adminHosts().includes(await headerHostname())) return null;
  const cookieStore = await cookies();
  const user = await getUserBySessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  if (!user || !isOperator(user)) return null;
  return user;
}

export async function currentProductUserFromRequest(request: Request, allowEmailBinding = false): Promise<ProductUser | null> {
  const header = request.headers.get("cookie") ?? "";
  const token = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return getUserBySessionToken(token, allowEmailBinding);
}

export async function currentEmailBindingUser() {
  const cookieStore = await cookies();
  return getUserBySessionToken(cookieStore.get(SESSION_COOKIE)?.value, true);
}

export async function rejectIfUnauthenticated(request: Request) {
  const user = await currentProductUserFromRequest(request);
  if (user) return null;
  return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
}
