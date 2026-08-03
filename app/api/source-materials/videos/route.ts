import { NextResponse } from "next/server";
import { addVideoLink, normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string; courseId?: string; knowledgeId?: string };
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    return NextResponse.json(await addVideoLink(ctx.courseId, ctx.knowledgeId, body.url || ""));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Add video failed" }, { status: 400 });
  }
}
