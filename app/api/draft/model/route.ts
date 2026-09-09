import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { saveSelectedModel } from "@/services/draftStore";
import { resolveModelMaxCompletionTokens } from "@/services/openRouterModelLimits";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as { courseId?: string; knowledgeId?: string; model?: string };
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    const selectedModel = await saveSelectedModel(ctx.courseId, ctx.knowledgeId, body.model || "openrouter/auto");
    const selectedModelLimit = resolveModelMaxCompletionTokens({ model: selectedModel.model, generationType: "full" });
    return NextResponse.json({ ...selectedModel, selectedModelLimit });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Selected model is not configured." }, { status: 400 });
  }
}
