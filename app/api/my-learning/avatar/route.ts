import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { getUserAvatar, removeUserAvatar, saveUserAvatar } from "@/services/productStore";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  const avatar = await getUserAvatar(user.id);
  if (!avatar) return new Response(null, { status: 404 });
  return new Response(avatar.buffer, { headers: { "Content-Type": avatar.contentType, "Cache-Control": "private, max-age=300" } });
}

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Select an image file.");
    if (file.size > 5 * 1024 * 1024) throw new Error("The image must be 5 MB or smaller.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
    const saved = await saveUserAvatar(user.id, Buffer.from(await file.arrayBuffer()), file.type as "image/jpeg" | "image/png" | "image/webp");
    return NextResponse.json({ ok: true, user: { id: saved.id, avatarUrl: "/api/my-learning/avatar" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Image upload failed." }, { status: 400 });
  }
}

export async function DELETE() {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try { await removeUserAvatar(user.id); return NextResponse.json({ ok: true }); } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Image removal failed." }, { status: 400 }); }
}
