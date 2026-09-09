import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { normaliseContext } from "@/services/sourceMaterialStore";
import { getWikiPage } from "@/services/wikiStore";

export async function GET(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  const { pageId } = await params;
  const url = new URL(request.url);
  const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId") || pageId);
  return NextResponse.json(await getWikiPage(ctx.courseId, ctx.knowledgeId));
}
