import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { runChatTesting, type ChatMode } from "@/services/chatTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    const question = String(body.question || "").trim();
    if (!question) throw new Error("Question is required.");
    const mode: ChatMode = body.mode === "socratic" ? "socratic" : "lecture";
    return NextResponse.json(await runChatTesting(ctx.courseId, ctx.knowledgeId, question, mode, body.routes || []));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Chat testing failed." }, { status: 400 });
  }
}
