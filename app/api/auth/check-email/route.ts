import { NextResponse } from "next/server";
import { getEmailAuthState } from "@/services/productStore";
import { isBusinessEmail, normaliseEmail } from "@/lib/emailValidation";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string };
    const email = typeof body.email === "string" ? normaliseEmail(body.email) : "";
    if (!isBusinessEmail(email)) {
      return NextResponse.json({ ok: false, error: "Enter a valid email address. Use letters, numbers, dots, underscores, hyphens and one @ only." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, data: await getEmailAuthState(email) });
  } catch {
    return NextResponse.json({ ok: false, error: "Email check failed." }, { status: 400 });
  }
}
