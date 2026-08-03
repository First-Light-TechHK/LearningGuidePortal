import { NextResponse } from "next/server";
import { normaliseContext } from "@/services/sourceMaterialStore";
import { deleteWikiEntry, updateWikiEntry } from "@/services/wikiStore";

export async function PUT(request: Request, { params }: { params: Promise<{ pageId: string; entryId: string }> }) {
  try {
    const { pageId, entryId } = await params;
    const body = (await request.json()) as { courseId?: string; knowledgeId?: string; title?: string; content?: string };
    const ctx = normaliseContext(body.courseId, body.knowledgeId || pageId);
    return NextResponse.json(await updateWikiEntry(ctx.courseId, ctx.knowledgeId, entryId, { title: body.title, content: body.content }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update entry failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ pageId: string; entryId: string }> }) {
  try {
    const { pageId, entryId } = await params;
    const url = new URL(request.url);
    const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId") || pageId);
    return NextResponse.json(await deleteWikiEntry(ctx.courseId, ctx.knowledgeId, entryId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Delete entry failed" }, { status: 400 });
  }
}
