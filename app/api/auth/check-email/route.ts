import { NextResponse } from "next/server";
import { getEmailAuthState } from "@/services/productStore";
import { isBusinessEmail, isEmailTooLong, normaliseEmail } from "@/lib/emailValidation";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string };
    const email = typeof body.email === "string" ? normaliseEmail(body.email) : "";
    if (isEmailTooLong(email)) {
      return NextResponse.json({ ok: false, code: "EMAIL_TOO_LONG" }, { status: 400 });
    }
    if (!isBusinessEmail(email)) {
      return NextResponse.json({ ok: false, code: "EMAIL_INVALID" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, data: await getEmailAuthState(email) });
  } catch {
    return NextResponse.json({ ok: false, code: "EMAIL_CHECK_FAILED" }, { status: 400 });
  }
}
