import { NextResponse } from "next/server";
import { resetPassword } from "@/services/productStore";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string; newPassword?: string };
    if (!body.token) return NextResponse.json({ ok: false, error: "Reset token is required." }, { status: 400 });
    await resetPassword(body.token, body.newPassword || "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Password reset failed." }, { status: 400 });
  }
}
