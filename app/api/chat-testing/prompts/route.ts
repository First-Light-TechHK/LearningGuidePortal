import { NextResponse } from "next/server";
import { savePromptSettings } from "@/services/chatTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    return NextResponse.json(await savePromptSettings(ctx.courseId, ctx.knowledgeId, body.promptSettings || body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save prompt settings failed." }, { status: 400 });
  }
}
