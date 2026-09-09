import { NextRequest } from "next/server";
import { currentProductUserFromRequest } from "@/services/productAuth";
import { publishDraft, WikiDraft } from "../../../lib/wiki-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await currentProductUserFromRequest(request);
  if (!user) return Response.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  const body = (await request.json()) as { topic?: string; draft?: WikiDraft };
  if (!body.draft) {
    return Response.json({ error: "Draft is required." }, { status: 400 });
  }

  const topic = body.topic || body.draft.topic || "Epicureanism";
  const result = await publishDraft(topic, { ...body.draft, topic });
  return Response.json({
    status: "published",
    topic,
    file: result.file,
    markdownChars: result.markdown.length,
    publishedAt: new Date().toISOString()
  });
}
