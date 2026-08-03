import { NextResponse } from "next/server";
import { saveGeneratedOutput, saveImportSourceOutput, saveIncrementalOutput } from "@/services/draftStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      courseId?: string;
      knowledgeId?: string;
      kind?: "generated" | "incremental" | "import_source";
      output?: string;
    };
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    if (body.kind === "generated") {
      await saveGeneratedOutput(ctx.courseId, ctx.knowledgeId, body.output || "");
      return NextResponse.json({ message: "Draft saved successfully." });
    }
    if (body.kind === "incremental") {
      await saveIncrementalOutput(ctx.courseId, ctx.knowledgeId, body.output || "");
      return NextResponse.json({ message: "Incremental draft saved successfully." });
    }
    if (body.kind === "import_source") {
      await saveImportSourceOutput(ctx.courseId, ctx.knowledgeId, body.output || "");
      return NextResponse.json({ message: "Import Source output saved successfully." });
    }
    return NextResponse.json({ error: "Invalid draft output kind." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save draft output failed" }, { status: 400 });
  }
}
