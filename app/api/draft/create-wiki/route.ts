import { NextResponse } from "next/server";
import { normaliseContext } from "@/services/sourceMaterialStore";
import { createWikiFromDraftOutput } from "@/services/wikiStore";

export async function POST(request: Request) {
  try {
    const { courseId, knowledgeId } = (await request.json()) as { courseId?: string; knowledgeId?: string };
    const ctx = normaliseContext(courseId, knowledgeId);
    return NextResponse.json(await createWikiFromDraftOutput(ctx.courseId, ctx.knowledgeId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Create wiki draft failed" }, { status: 400 });
  }
}
