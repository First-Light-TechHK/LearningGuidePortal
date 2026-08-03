import { NextResponse } from "next/server";
import { normaliseContext } from "@/services/sourceMaterialStore";
import { addComment, deleteComment, getComments } from "@/services/wikiStore";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId"));
  const entryId = url.searchParams.get("entryId") || undefined;
  return NextResponse.json({ comments: await getComments(ctx.courseId, ctx.knowledgeId, entryId) });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { entryId?: string; text?: string; courseId?: string; knowledgeId?: string };
    if (!body.entryId || !body.text?.trim()) return NextResponse.json({ error: "Missing comment fields" }, { status: 400 });
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    return NextResponse.json({ comments: await addComment(ctx.courseId, ctx.knowledgeId, body.entryId, body.text) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save comment failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { commentId?: string; courseId?: string; knowledgeId?: string };
    if (!body.commentId) return NextResponse.json({ error: "Missing comment id" }, { status: 400 });
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    return NextResponse.json({ comments: await deleteComment(ctx.courseId, ctx.knowledgeId, body.commentId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Delete comment failed" }, { status: 400 });
  }
}
