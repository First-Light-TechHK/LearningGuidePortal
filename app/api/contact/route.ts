import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ContactError } from "@/contracts/contact";
import { currentProductUser } from "@/services/productAuth";
import { submitContactRequest } from "@/services/contactService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    let input: unknown;
    try { input = await request.json(); } catch { throw new ContactError("CONTACT_INVALID"); }
    const user = await currentProductUser();
    const result = await submitContactRequest(input, user?.id || null);
    return NextResponse.json({ ok: true, data: result, requestId }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const failure = error instanceof ContactError ? error : new ContactError("CONTACT_UNAVAILABLE", 503);
    return NextResponse.json({ ok: false, code: failure.code, message: failure.code, requestId }, { status: failure.status });
  }
}
