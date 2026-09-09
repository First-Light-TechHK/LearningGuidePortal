import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { normaliseContext } from "@/services/sourceMaterialStore";
import { parseVideoTranscript } from "@/services/transcriptProvider";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const url = new URL(request.url);
    const ctx = normaliseContext(body.courseId || url.searchParams.get("courseId"), body.knowledgeId || url.searchParams.get("knowledgeId"));
    const { id } = await params;
    return NextResponse.json(await parseVideoTranscript(ctx.courseId, ctx.knowledgeId, id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Parse transcript failed" },
      { status: 400 }
    );
  }
}
