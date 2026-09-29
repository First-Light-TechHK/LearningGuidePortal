import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { checkEntitlement } from "@/services/productStore";

export async function GET(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const courseId = params.get("courseId") || "";
  const device = params.get("device");
  if (!courseId) return NextResponse.json({ ok: false, error: "Course is required." }, { status: 400 });
  const entitlement = await checkEntitlement(user.id, courseId);
  if (device && (device === "pc" || device === "mobile") && entitlement.allowed && entitlement.device && entitlement.device !== device) {
    return NextResponse.json({ ok: true, entitlement: { allowed: false, source: null, validTo: null, device: entitlement.device } });
  }
  return NextResponse.json({ ok: true, entitlement });
}
