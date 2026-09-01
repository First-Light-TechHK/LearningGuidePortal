import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { createCourseForOperator, ensureProductData, isOperator } from "@/services/productStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentProductUser();
  if (!user || !isOperator(user)) return NextResponse.json({ ok: false, error: "Course Manager/Operator access is required." }, { status: 403 });
  const data = await ensureProductData();
  return NextResponse.json({ ok: true, courses: data.courses });
}

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user || !isOperator(user)) return NextResponse.json({ ok: false, error: "Course Manager/Operator access is required." }, { status: 403 });
  try {
    const body = await request.json() as { title?: string; description?: string };
    return NextResponse.json({ ok: true, course: await createCourseForOperator({ title: body.title || "", description: body.description }) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Course creation failed." }, { status: 400 });
  }
}
