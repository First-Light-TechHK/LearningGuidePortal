import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { deleteVideoLink, normaliseContext } from "@/services/sourceMaterialStore";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId"));
  const { id } = await params;
  return NextResponse.json(await deleteVideoLink(ctx.courseId, ctx.knowledgeId, id));
}
