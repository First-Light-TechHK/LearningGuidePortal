import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  // D2.5 ML-FR-019: placeholder only — do not expose an inbox or unread count.
  return NextResponse.json({ ok: true, placeholder: true, notifications: [], unreadCount: 0 });
}
