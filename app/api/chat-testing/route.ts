import { NextResponse } from "next/server";
import { getChatTestingState } from "@/services/chatTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId"));
  return NextResponse.json(await getChatTestingState(ctx.courseId, ctx.knowledgeId));
}
