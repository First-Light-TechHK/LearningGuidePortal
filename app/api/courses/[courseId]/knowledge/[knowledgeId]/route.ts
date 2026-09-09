import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { deleteKnowledge, renameKnowledge } from "@/services/knowledgeStore";

export async function PUT(request: Request, { params }: { params: Promise<{ courseId: string; knowledgeId: string }> }) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const { courseId, knowledgeId } = await params;
    const { title } = (await request.json()) as { title?: string };
    if (!title?.trim()) return NextResponse.json({ error: "Knowledge title is required" }, { status: 400 });
    return NextResponse.json(await renameKnowledge(courseId, knowledgeId, title));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rename knowledge failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ courseId: string; knowledgeId: string }> }) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  const { courseId, knowledgeId } = await params;
  await deleteKnowledge(courseId, knowledgeId);
  return NextResponse.json({ ok: true });
}
