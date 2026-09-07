import { NextResponse } from "next/server";
import { userEmailExists } from "@/services/productStore";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string };
    return NextResponse.json({ ok: true, exists: await userEmailExists(body.email || "") });
  } catch {
    return NextResponse.json({ ok: false, error: "Email check failed." }, { status: 400 });
  }
}
