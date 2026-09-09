import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  // D2.5 ML-FR-019: no read/unread API in the test release.
  return NextResponse.json({ ok: false, placeholder: true, error: "Notifications are not active in the current test release." }, { status: 404 });
}
