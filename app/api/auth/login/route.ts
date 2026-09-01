import { NextResponse } from "next/server";
import { authenticateUser, createSession, publicUser } from "@/services/productStore";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string };
    const user = await authenticateUser(body.email || "", body.password || "");
    const session = await createSession(user.id);
    const response = NextResponse.json({ ok: true, user: publicUser(user) });
    response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE });
    return response;
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Sign in failed." }, { status: 401 });
  }
}
