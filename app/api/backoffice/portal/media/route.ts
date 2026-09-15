import { NextResponse } from "next/server";
import { currentOperatorUser } from "@/services/productAuth";
import { isOperator } from "@/services/productStore";
import { listPortalLibrary, PORTAL_MEDIA_MAX_BYTES, savePortalMedia } from "@/services/portalMedia";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentOperatorUser();
  if (!user || !isOperator(user)) return NextResponse.json({ error: "Operator access required." }, { status: 403 });
  return NextResponse.json({ library: await listPortalLibrary() });
}

export async function POST(request: Request) {
  const user = await currentOperatorUser();
  if (!user || !isOperator(user)) return NextResponse.json({ error: "Operator access required." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Select an image file.");
    if (file.size > PORTAL_MEDIA_MAX_BYTES) throw new Error("The image must be 5 MB or smaller.");
    const saved = await savePortalMedia(file.name, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ asset: saved, library: await listPortalLibrary() }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Image upload failed." }, { status: 400 });
  }
}
