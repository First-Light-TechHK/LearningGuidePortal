import { NextResponse } from "next/server";
import { saveChatTestingRun, type ChatMode } from "@/services/chatTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    const question = String(body.question || "").trim();
    if (!question) throw new Error("Question is required.");
    const mode: ChatMode = body.mode === "socratic" ? "socratic" : "lecture";
    const results = Array.isArray(body.results) ? body.results : [];
    return NextResponse.json(await saveChatTestingRun(ctx.courseId, ctx.knowledgeId, question, mode, results));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save run failed." }, { status: 400 });
  }
}
