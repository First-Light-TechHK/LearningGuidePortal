import { NextResponse } from "next/server";
import { listPlansForPurchase } from "@/services/productStore";
import { currentProductUserFromRequest } from "@/services/productAuth";

export async function GET(request: Request) {
  const courseId = new URL(request.url).searchParams.get("courseId") || undefined;
  const user = await currentProductUserFromRequest(request);
  return NextResponse.json({ ok: true, plans: await listPlansForPurchase(user?.id, courseId) }, {
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
