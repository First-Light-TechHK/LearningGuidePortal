import path from "path";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { NextResponse } from "next/server";
import { readBinary } from "@/services/fileStore";
import { normaliseContext, transcriptFilePath } from "@/services/sourceMaterialStore";

export async function GET(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId"));
    const relativePath = url.searchParams.get("path") || "";
    const filePath = transcriptFilePath(ctx.courseId, ctx.knowledgeId, relativePath);
    const buffer = await readBinary(filePath);
    const fileName = path.basename(filePath);
    const contentType = fileName.endsWith(".json") ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Download transcript failed" },
      { status: 404 }
    );
  }
}
