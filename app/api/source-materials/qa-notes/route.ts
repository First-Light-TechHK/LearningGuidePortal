import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { normaliseContext, saveQaNotes } from "@/services/sourceMaterialStore";

export async function POST(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const form = await request.formData();
    const ctx = normaliseContext(String(form.get("courseId") || url.searchParams.get("courseId") || ""), String(form.get("knowledgeId") || url.searchParams.get("knowledgeId") || ""));
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file supplied" }, { status: 400 });
    return NextResponse.json(await saveQaNotes(ctx.courseId, ctx.knowledgeId, file));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 });
  }
}
