import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { adminHosts, isAdminHost, isKnowledgeAdminPath, requestOriginMatches } from "./adminHost";
import { getUserBySessionToken, isOperator, type ProductUser } from "./productStore";
import { canAuthorCourses } from "./backofficeAccess";

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

export async function currentBackofficeAuthor(): Promise<ProductUser | null> {
  if (!adminHosts().includes(await headerHostname())) return null;
  const cookieStore = await cookies();
  const user = await getUserBySessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  return user && canAuthorCourses(user) ? user : null;
}

function requestCookie(request: Request, name: string) {
  return (request.headers.get("cookie") || "").split(";").map(part => part.trim()).find(part => part.startsWith(name + "="))?.slice(name.length + 1);
}

export async function currentAuthorRequest(request: Request): Promise<ProductUser | null> {
  if (!isAdminHost(request)) return null;
  const user = await getUserBySessionToken(requestCookie(request, ADMIN_SESSION_COOKIE));
  return user && canAuthorCourses(user) ? user : null;
}

export async function currentOperatorRequest(request: Request): Promise<ProductUser | null> {
  const user = await currentAuthorRequest(request);
  return user && isOperator(user) ? user : null;
}

export async function currentCourseMediaUser(request: Request): Promise<ProductUser | null> {
  return isAdminHost(request) ? currentAuthorRequest(request) : currentProductUserFromRequest(request);
}

export async function isCurrentAdminHost() {
  return adminHosts().includes(await headerHostname());
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
  if (isAdminHost(request) && isKnowledgeAdminPath(new URL(request.url).pathname)) {
    const user = await currentAuthorRequest(request);
    if (user && isOperator(user) && (["GET", "HEAD", "OPTIONS"].includes(request.method) || requestOriginMatches(request))) return null;
    return NextResponse.json({ ok: false, error: "Operator access is required." }, { status: user ? 403 : 401, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  }
  const user = await currentProductUserFromRequest(request);
  if (user) return null;
  return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
}
