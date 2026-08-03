import { NextResponse } from "next/server";
import { getDialogueTestingState } from "@/services/dialogueTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId"));
  return NextResponse.json(await getDialogueTestingState(ctx.courseId, ctx.knowledgeId));
}
