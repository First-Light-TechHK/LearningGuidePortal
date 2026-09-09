import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { createImportSourceOutput } from "@/services/importSourceOutputStore";
import { normaliseContext } from "@/services/sourceMaterialStore";
import type { RequestedSelectableSource } from "@/services/selectableSourceStore";

type ImportSourceRequest = {
  courseId?: string;
  knowledgeId?: string;
  sources?: RequestedSelectableSource[];
  selectedFiles?: RequestedSelectableSource[];
};

export async function POST(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as ImportSourceRequest;
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    const result = await createImportSourceOutput(ctx.courseId, ctx.knowledgeId, body.selectedFiles || body.sources || []);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import source failed" },
      { status: 400 }
    );
  }
}
