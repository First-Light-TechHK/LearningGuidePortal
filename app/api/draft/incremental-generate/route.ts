import { NextResponse } from "next/server";
import { generateIncrementalDraft } from "@/lib/extract";
import { assertConfiguredModel } from "@/services/modelStore";
import { saveRequirements, saveSelectedModel } from "@/services/draftStore";
import { normaliseContext } from "@/services/sourceMaterialStore";
import type { RequestedSelectableSource } from "@/services/selectableSourceStore";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      requirements?: string;
      courseId?: string;
      knowledgeId?: string;
      selectedFiles?: RequestedSelectableSource[];
      selectedSourceIds?: string[];
      model?: string;
    };
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    await saveRequirements(ctx.courseId, ctx.knowledgeId, body.requirements || "");
    const selectedFiles = Array.isArray(body.selectedFiles)
      ? body.selectedFiles
      : Array.isArray(body.selectedSourceIds)
        ? body.selectedSourceIds.map((sourceId) => ({ sourceType: "document" as const, sourceId }))
        : [];
    if (!selectedFiles.length) {
      return NextResponse.json({ error: "Select at least one source file for incremental generation." }, { status: 400 });
    }
    const configuredModel = assertConfiguredModel(body.model || "openrouter/auto");
    await saveSelectedModel(ctx.courseId, ctx.knowledgeId, configuredModel.id);
    const result = await generateIncrementalDraft(body.requirements || "", ctx.courseId, ctx.knowledgeId, selectedFiles, configuredModel.id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Incremental draft generation failed";
    const status = message.includes("Select at least one") || message.includes("not found") || message === "Selected model is not configured." ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
