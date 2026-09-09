import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { generateDraft } from "@/lib/extract";
import { assertConfiguredModel } from "@/services/modelStore";
import { saveRequirements, saveSelectedModel } from "@/services/draftStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as { requirements?: string; courseId?: string; knowledgeId?: string; model?: string };
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    await saveRequirements(ctx.courseId, ctx.knowledgeId, body.requirements || "");
    const configuredModel = assertConfiguredModel(body.model || "openrouter/auto");
    await saveSelectedModel(ctx.courseId, ctx.knowledgeId, configuredModel.id);
    const result = await generateDraft(body.requirements || "", ctx.courseId, ctx.knowledgeId, configuredModel.id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Draft generation failed";
    return NextResponse.json({ error: message }, { status: message === "Selected model is not configured." ? 400 : 502 });
  }
}
