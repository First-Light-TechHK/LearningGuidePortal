import { NextRequest } from "next/server";
import { saveDraft, WikiDraft } from "../../../lib/wiki-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { topic?: string; draft?: WikiDraft };
  if (!body.draft) {
    return Response.json({ error: "Draft is required." }, { status: 400 });
  }

  const topic = body.topic || body.draft.topic || "Epicureanism";
  const file = await saveDraft(topic, { ...body.draft, topic });
  return Response.json({
    status: "saved",
    topic,
    file,
    savedAt: new Date().toISOString()
  });
}
