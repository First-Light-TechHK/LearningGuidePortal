import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { createKnowledge, listKnowledge } from "@/services/knowledgeStore";

export async function GET(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  const { courseId } = await params;
  return NextResponse.json({ knowledge: await listKnowledge(courseId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const { courseId } = await params;
    const { title } = (await request.json()) as { title?: string };
    if (!title?.trim()) return NextResponse.json({ error: "Knowledge title is required" }, { status: 400 });
    return NextResponse.json(await createKnowledge(courseId, title));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Create knowledge failed" }, { status: 400 });
  }
}
