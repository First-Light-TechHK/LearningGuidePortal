import { NextResponse } from "next/server";
import { normaliseContext } from "@/services/sourceMaterialStore";
import { applyIncrementalWikiUpdate } from "@/services/wikiStore";

export async function POST(request: Request) {
  try {
    const { courseId, knowledgeId, incrementalMarkdown } = (await request.json()) as { courseId?: string; knowledgeId?: string; incrementalMarkdown?: string };
    const ctx = normaliseContext(courseId, knowledgeId);
    const result = await applyIncrementalWikiUpdate(ctx.courseId, ctx.knowledgeId, incrementalMarkdown);
    return NextResponse.json({
      ...result,
      message: `Wiki updated successfully. ${result.updatedCount} entries updated, ${result.addedCount} entries added.`
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update wiki failed" }, { status: 400 });
  }
}
