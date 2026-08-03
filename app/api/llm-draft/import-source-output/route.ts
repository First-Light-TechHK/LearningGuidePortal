import { NextResponse } from "next/server";
import { createImportSourceOutput } from "@/services/importSourceOutputStore";
import { normaliseContext } from "@/services/sourceMaterialStore";
import type { RequestedSelectableSource } from "@/services/selectableSourceStore";

type ImportSourceOutputRequest = {
  courseId?: string;
  knowledgeId?: string;
  selectedFiles?: RequestedSelectableSource[];
  sources?: RequestedSelectableSource[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ImportSourceOutputRequest;
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    const selectedFiles = body.selectedFiles || body.sources || [];
    const result = await createImportSourceOutput(ctx.courseId, ctx.knowledgeId, selectedFiles);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import source output failed" },
      { status: 400 }
    );
  }
}
