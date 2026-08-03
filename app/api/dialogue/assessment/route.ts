import { NextResponse } from "next/server";
import { assessStandaloneDialogue, getLatestStandaloneDialogueAssessment, type DialogueAssessmentResult } from "@/services/dialogueTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ctx = normaliseContext(searchParams.get("courseId") || undefined, searchParams.get("knowledgeId") || undefined);
    return NextResponse.json({ assessment: await getLatestStandaloneDialogueAssessment(ctx.courseId, ctx.knowledgeId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Load assessment failed." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      courseId?: string;
      knowledgeId?: string;
      startRound?: number;
      endRound?: number;
      selectionMethod?: DialogueAssessmentResult["selection_method"];
    };
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    const assessment = await assessStandaloneDialogue(
      ctx.courseId,
      ctx.knowledgeId,
      body.startRound ?? -1,
      body.endRound ?? -1,
      body.selectionMethod === "user_selected_turns" ? "user_selected_turns" : "default_latest_turns"
    );
    return NextResponse.json({ assessment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dialogue assessment failed.";
    const status = message.includes("Select at least") || message.includes("not configured") || message.includes("No Dialogue Testing route") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
