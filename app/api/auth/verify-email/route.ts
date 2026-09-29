import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { publicUser, verifyEmailToken } from "@/services/productStore";

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const body = await request.json() as { token?: string };
    if (!body.token) return NextResponse.json({ ok: false, code: "VERIFICATION_TOKEN_REQUIRED", requestId }, { status: 400 });
    return NextResponse.json({ ok: true, data: { user: publicUser(await verifyEmailToken(body.token)) }, requestId });
  } catch {
    return NextResponse.json({ ok: false, code: "VERIFICATION_TOKEN_INVALID", requestId }, { status: 400 });
  }
}
