import { NextResponse } from "next/server";
import { currentProductUserFromRequest } from "@/services/productAuth";
import { requestEmailBinding } from "@/services/emailBindingService";
import type { EmailBindingRequest } from "@/contracts/emailBinding";

export async function POST(request: Request) {
  const user = await currentProductUserFromRequest(request, true);
  if (!user) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  try {
    const body = await request.json() as EmailBindingRequest;
    if (typeof body.email !== "string" || (body.returnTo !== undefined && typeof body.returnTo !== "string")) throw new Error("invalid_email");
    return NextResponse.json({ ok: true, ...await requestEmailBinding(user.id, body, request) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_email";
    const known = ["unauthorised", "invalid_email", "already_bound", "email_in_use", "cooldown", "email_unavailable"].includes(code) ? code : "email_unavailable";
    return NextResponse.json({ ok: false, code: known }, { status: known === "cooldown" ? 429 : known === "email_unavailable" ? 503 : 400 });
  }
}
