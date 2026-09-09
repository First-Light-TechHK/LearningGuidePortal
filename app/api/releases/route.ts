import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { createRelease, listReleases } from "@/services/releaseStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function GET(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId"));
  return NextResponse.json({ releases: await listReleases(ctx.courseId, ctx.knowledgeId) });
}

export async function POST(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as { revisionNotes?: string; courseId?: string; knowledgeId?: string; pageId?: string };
    const ctx = normaliseContext(body.courseId, body.knowledgeId || body.pageId);
    const release = await createRelease(ctx.courseId, ctx.knowledgeId, body.revisionNotes || "");
    return NextResponse.json(release);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Publish failed" }, { status: 400 });
  }
}
