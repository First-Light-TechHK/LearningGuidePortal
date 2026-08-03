import { NextResponse } from "next/server";
import { normaliseContext } from "@/services/sourceMaterialStore";
import { addWikiEntry } from "@/services/wikiStore";

export async function POST(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  try {
    const { pageId } = await params;
    const body = (await request.json()) as { courseId?: string; knowledgeId?: string; title?: string; content?: string };
    const ctx = normaliseContext(body.courseId, body.knowledgeId || pageId);
    return NextResponse.json(await addWikiEntry(ctx.courseId, ctx.knowledgeId, { title: body.title, content: body.content }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Add entry failed" }, { status: 400 });
  }
}
