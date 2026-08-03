import { NextResponse } from "next/server";
import { createImportSourceOutput } from "@/services/importSourceOutputStore";
import { createRelease } from "@/services/releaseStore";
import { normaliseContext, saveFiles } from "@/services/sourceMaterialStore";
import { createWikiFromImportSourceOutput } from "@/services/wikiStore";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const ctx = normaliseContext(
      String(form.get("targetCourseId") || form.get("courseId") || ""),
      String(form.get("targetKnowledgeId") || form.get("knowledgeId") || "")
    );
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Select a source file to upload.");

    const manifest = await saveFiles(ctx.courseId, ctx.knowledgeId, [file]);
    const uploaded = manifest.files[manifest.files.length - 1];
    if (!uploaded) throw new Error("Upload failed.");

    const importResult = await createImportSourceOutput(ctx.courseId, ctx.knowledgeId, [
      { sourceType: "document", sourceId: uploaded.id }
    ]);
    const wikiResult = await createWikiFromImportSourceOutput(ctx.courseId, ctx.knowledgeId, importResult.output);
    const release = await createRelease(ctx.courseId, ctx.knowledgeId, `Auto-published from ${uploaded.originalName}`);

    return NextResponse.json({
      courseId: ctx.courseId,
      knowledgeId: ctx.knowledgeId,
      uploadedFile: uploaded,
      importResult,
      wikiResult,
      release
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import and publish knowledge failed." },
      { status: 400 }
    );
  }
}
