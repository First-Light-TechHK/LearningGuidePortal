import { getPortalMedia } from "@/services/portalMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const file = await getPortalMedia(assetId);
  if (!file) return new Response(null, { status: 404 });
  return new Response(file.buffer, {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=86400"
    }
  });
}
