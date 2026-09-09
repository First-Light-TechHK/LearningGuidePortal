import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { savePromptSettings } from "@/services/chatTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    return NextResponse.json(await savePromptSettings(ctx.courseId, ctx.knowledgeId, body.promptSettings || body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save prompt settings failed." }, { status: 400 });
  }
}
