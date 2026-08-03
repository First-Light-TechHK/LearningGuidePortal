import { NextResponse } from "next/server";
import { normaliseContext } from "@/services/sourceMaterialStore";
import { createWikiFromImportSourceOutput } from "@/services/wikiStore";

export async function POST(request: Request) {
  try {
    const { courseId, knowledgeId, importSourceMarkdown } = (await request.json()) as {
      courseId?: string;
      knowledgeId?: string;
      importSourceMarkdown?: string;
    };
    const ctx = normaliseContext(courseId, knowledgeId);
    const result = await createWikiFromImportSourceOutput(ctx.courseId, ctx.knowledgeId, importSourceMarkdown || "");
    return NextResponse.json({
      ...result,
      message: `Wiki imported successfully. ${result.importedEntryCount} entries created.`
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import Source Output to Wiki failed" },
      { status: 400 }
    );
  }
}
