import { listPortalLibrary, PORTAL_MEDIA_MAX_BYTES, savePortalMedia } from "@/services/portalMedia";
import { portalCmsAccess, portalCmsFailure, portalCmsResponse, PortalCmsBodyTooLarge, readPortalCmsBody } from "@/services/portalCmsHttp";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = await portalCmsAccess(request);
  if (denied) return denied;
  return portalCmsResponse({ library: await listPortalLibrary() });
}

export async function POST(request: Request) {
  const denied = await portalCmsAccess(request, true);
  if (denied) return denied;
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new Error("A multipart image upload is required.");
    const bytes = await readPortalCmsBody(request, PORTAL_MEDIA_MAX_BYTES + 64 * 1024);
    const form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1) throw new Error("Select one image file.");
    if (file.size > PORTAL_MEDIA_MAX_BYTES) throw new PortalCmsBodyTooLarge();
    const saved = await savePortalMedia(file.name, Buffer.from(await file.arrayBuffer()));
    return portalCmsResponse({ asset: saved, library: await listPortalLibrary() }, 201);
  } catch (error) {
    return portalCmsFailure(error, "Image upload failed.");
  }
}
