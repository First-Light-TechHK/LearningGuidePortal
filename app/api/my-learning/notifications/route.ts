import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview } from "@/services/productStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  const overview = await getLearningOverview(user.id);
  return NextResponse.json({ ok: true, notifications: overview.notifications, unreadCount: overview.notifications.filter((item) => !item.readAt).length });
}
