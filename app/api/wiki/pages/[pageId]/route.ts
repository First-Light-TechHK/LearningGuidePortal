import { NextResponse } from "next/server";
import { normaliseContext } from "@/services/sourceMaterialStore";
import { getWikiPage } from "@/services/wikiStore";

export async function GET(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const url = new URL(request.url);
  const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId") || pageId);
  return NextResponse.json(await getWikiPage(ctx.courseId, ctx.knowledgeId));
}
