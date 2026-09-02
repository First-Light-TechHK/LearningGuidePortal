import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { publicUser, verifyEmailToken } from "@/services/productStore";

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const body = await request.json() as { token?: string };
    if (!body.token) return NextResponse.json({ ok: false, code: "VERIFICATION_TOKEN_REQUIRED", message: "Verification token is required.", requestId }, { status: 400 });
    return NextResponse.json({ ok: true, data: { user: publicUser(await verifyEmailToken(body.token)) }, requestId });
  } catch (error) {
    return NextResponse.json({ ok: false, code: "VERIFICATION_TOKEN_INVALID", message: error instanceof Error ? error.message : "Email verification failed.", requestId }, { status: 400 });
  }
}
