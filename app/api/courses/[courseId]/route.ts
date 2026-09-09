import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { deleteCourse, renameCourse } from "@/services/courseStore";

export async function PUT(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const { courseId } = await params;
    const { title } = (await request.json()) as { title?: string };
    if (!title?.trim()) return NextResponse.json({ error: "Course name is required" }, { status: 400 });
    return NextResponse.json(await renameCourse(courseId, title));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rename course failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  const { courseId } = await params;
  await deleteCourse(courseId);
  return NextResponse.json({ ok: true });
}
