import { NextResponse } from "next/server";
import { getSourceMaterials, normaliseContext, saveSourceMaterials } from "@/services/sourceMaterialStore";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId"));
  return NextResponse.json(await getSourceMaterials(ctx.courseId, ctx.knowledgeId));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const url = new URL(request.url);
  const ctx = normaliseContext(body.courseId || url.searchParams.get("courseId"), body.knowledgeId || url.searchParams.get("knowledgeId"));
  const sources = await getSourceMaterials(ctx.courseId, ctx.knowledgeId);
  await saveSourceMaterials(ctx.courseId, ctx.knowledgeId, sources);
  return NextResponse.json(sources);
}
