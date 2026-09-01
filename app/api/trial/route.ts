import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { activateTrial } from "@/services/productStore";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { courseId?: string };
    const entitlement = await activateTrial(user.id, body.courseId || "");
    return NextResponse.json({ ok: true, entitlement });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Trial activation failed." }, { status: 400 });
  }
}
