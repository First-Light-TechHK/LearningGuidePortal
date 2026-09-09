import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { normaliseContext } from "@/services/sourceMaterialStore";
import { createWikiFromDraftOutput } from "@/services/wikiStore";

export async function POST(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const { courseId, knowledgeId } = (await request.json()) as { courseId?: string; knowledgeId?: string };
    const ctx = normaliseContext(courseId, knowledgeId);
    return NextResponse.json(await createWikiFromDraftOutput(ctx.courseId, ctx.knowledgeId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Create wiki draft failed" }, { status: 400 });
  }
}
