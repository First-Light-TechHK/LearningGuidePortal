import { NextRequest } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return Response.json({ text: result.value.trim(), messages: result.messages });
  }

  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".srt")) {
    return Response.json({ text: buffer.toString("utf8").trim(), messages: [] });
  }

  return Response.json(
    { error: "Supported files: DOCX, TXT, MD, SRT." },
    { status: 415 }
  );
}
