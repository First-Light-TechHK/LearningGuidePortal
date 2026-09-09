import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { saveDialogueRoutes, saveDialogueSessionConfig } from "@/services/dialogueTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    if (Array.isArray(body.routes)) {
      return NextResponse.json(await saveDialogueRoutes(ctx.courseId, ctx.knowledgeId, body.routes));
    }
    return NextResponse.json(await saveDialogueSessionConfig(ctx.courseId, ctx.knowledgeId, body.config || body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save session configuration failed." }, { status: 400 });
  }
}
