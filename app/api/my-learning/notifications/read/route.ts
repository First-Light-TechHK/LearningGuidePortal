import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { setNotificationRead } from "@/services/productStore";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { notificationId?: string; read?: boolean };
    return NextResponse.json({ ok: true, notification: await setNotificationRead(user.id, body.notificationId || "", body.read !== false) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Notification update failed." }, { status: 400 });
  }
}
