import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { normaliseContext } from "@/services/sourceMaterialStore";
import { extractSourceReferences, removeSourceReference } from "@/services/wikiStore";

export async function GET(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId"));
  return NextResponse.json({ references: await extractSourceReferences(ctx.courseId, ctx.knowledgeId) });
}

export async function DELETE(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as {
      courseId?: string;
      knowledgeId?: string;
      entryId?: string;
      linkText?: string;
      url?: string;
    };
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    if (!body.entryId || !body.linkText || !body.url) throw new Error("Missing source reference details");
    await removeSourceReference(ctx.courseId, ctx.knowledgeId, body.entryId, body.linkText, body.url);
    return NextResponse.json({ references: await extractSourceReferences(ctx.courseId, ctx.knowledgeId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Remove source reference failed" }, { status: 400 });
  }
}
