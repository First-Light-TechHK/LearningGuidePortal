import { NextResponse } from "next/server";
import { saveRouteConfig } from "@/services/chatTestingStore";
import { normaliseContext } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ctx = normaliseContext(body.courseId, body.knowledgeId);
    return NextResponse.json(await saveRouteConfig(ctx.courseId, ctx.knowledgeId, body.routes || []));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save route configuration failed." }, { status: 400 });
  }
}
