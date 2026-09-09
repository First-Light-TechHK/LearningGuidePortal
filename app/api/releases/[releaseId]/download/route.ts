import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { downloadRelease } from "@/services/releaseStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function GET(request: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const { releaseId } = await params;
    const url = new URL(request.url);
    const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId"));
    const release = await downloadRelease(ctx.courseId, ctx.knowledgeId, releaseId);
    return new NextResponse(release.content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${release.fileName}"`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Download failed" }, { status: 404 });
  }
}
