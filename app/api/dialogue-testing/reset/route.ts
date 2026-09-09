import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { resetDialogueSession } from "@/services/dialogueTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    return NextResponse.json(await resetDialogueSession(ctx.courseId, ctx.knowledgeId, body.mode));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reset dialogue session failed." }, { status: 400 });
  }
}
