import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { checkEntitlement } from "@/services/productStore";

export async function GET(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  const courseId = new URL(request.url).searchParams.get("courseId") || "";
  if (!courseId) return NextResponse.json({ ok: false, error: "Course is required." }, { status: 400 });
  return NextResponse.json({ ok: true, entitlement: await checkEntitlement(user.id, courseId) });
}
