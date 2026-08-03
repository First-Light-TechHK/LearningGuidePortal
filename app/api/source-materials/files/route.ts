import { NextResponse } from "next/server";
import { deleteSourceMaterialFile, normaliseContext, saveFiles, type SourceFileType } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const form = await request.formData();
    const ctx = normaliseContext(String(form.get("courseId") || url.searchParams.get("courseId") || ""), String(form.get("knowledgeId") || url.searchParams.get("knowledgeId") || ""));
    const incoming = form.getAll("files").filter((item): item is File => item instanceof File);
    return NextResponse.json(await saveFiles(ctx.courseId, ctx.knowledgeId, incoming));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as {
      courseId?: string;
      knowledgeId?: string;
      sourceType?: SourceFileType;
      fileId?: string;
      storedName?: string;
      relativePath?: string;
    };
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    const sourceType: SourceFileType = body.sourceType === "qa_note" ? "qa_note" : "file";
    return NextResponse.json(await deleteSourceMaterialFile(ctx.courseId, ctx.knowledgeId, sourceType, {
      fileId: body.fileId,
      storedName: body.storedName,
      relativePath: body.relativePath
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Remove file failed" }, { status: 400 });
  }
}
