import { NextResponse } from "next/server";
import { listPlans } from "@/services/productStore";

export async function GET(request: Request) {
  const courseId = new URL(request.url).searchParams.get("courseId") || undefined;
  return NextResponse.json({ ok: true, plans: await listPlans(courseId) });
}
