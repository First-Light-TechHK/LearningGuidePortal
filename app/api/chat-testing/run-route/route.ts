import { NextResponse } from "next/server";
import { streamChatTestingRoute, type ChatMode } from "@/services/chatTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    const question = String(body.question || "").trim();
    if (!question) throw new Error("Question is required.");
    if (!body.route) throw new Error("Route is required.");
    const mode: ChatMode = body.mode === "socratic" ? "socratic" : "lecture";
    const { stream, route } = await streamChatTestingRoute(ctx.courseId, ctx.knowledgeId, question, mode, body.route);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Route-Id": route.id,
        "X-Model": route.model
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Route failed.";
    return new NextResponse(message, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
