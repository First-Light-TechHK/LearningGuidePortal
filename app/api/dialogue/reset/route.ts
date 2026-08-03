import { NextResponse } from "next/server";
import { resetStandaloneDialogueSession } from "@/services/dialogueTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    return NextResponse.json(await resetStandaloneDialogueSession(ctx.courseId, ctx.knowledgeId, body.mode));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reset dialogue session failed." }, { status: 400 });
  }
}
