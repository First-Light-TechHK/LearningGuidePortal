import { NextResponse } from "next/server";
import { userEmailExists } from "@/services/productStore";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, data: { exists: await userEmailExists(email) } });
  } catch {
    return NextResponse.json({ ok: false, error: "Email check failed." }, { status: 400 });
  }
}
