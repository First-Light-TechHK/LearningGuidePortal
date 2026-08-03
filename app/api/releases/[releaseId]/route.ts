import { NextResponse } from "next/server";
import { deleteRelease } from "@/services/releaseStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function DELETE(request: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  try {
    const { releaseId } = await params;
    const url = new URL(request.url);
    const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId"));
    return NextResponse.json({ releases: await deleteRelease(ctx.courseId, ctx.knowledgeId, releaseId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Delete release failed" }, { status: 400 });
  }
}
