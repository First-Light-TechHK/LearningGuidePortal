import { NextResponse } from "next/server";
import { streamDialogueMessage } from "@/services/dialogueTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    const { stream, userMessage, config } = await streamDialogueMessage(
      ctx.courseId,
      ctx.knowledgeId,
      body.mode,
      body.config || {},
      body.messages || [],
      body.input || "",
      "primary",
      "dialogue",
      body.modelState || ""
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-User-Message-Id": userMessage.id,
        "X-User-Message-Created-At": userMessage.createdAt,
        "X-Model": config.model,
        "X-Release-Id": config.releaseId || "",
        "X-Use-Knowledge": config.useKnowledge ? "true" : "false"
      }
    });
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : "Dialogue send failed.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
