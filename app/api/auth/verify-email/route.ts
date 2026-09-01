import { NextResponse } from "next/server";
import { publicUser, verifyEmailToken } from "@/services/productStore";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string };
    if (!body.token) return NextResponse.json({ ok: false, error: "Verification token is required." }, { status: 400 });
    return NextResponse.json({ ok: true, user: publicUser(await verifyEmailToken(body.token)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Email verification failed." }, { status: 400 });
  }
}
