import { getPortalContent, savePortalContent } from "@/services/productStore";
import { portalCmsAccess, portalCmsBody, portalCmsFailure, portalCmsResponse } from "@/services/portalCmsHttp";

export async function GET(request: Request) {
  const denied = await portalCmsAccess(request);
  if (denied) return denied;
  return portalCmsResponse({ content: await getPortalContent() });
}
export async function PUT(request: Request) {
  const denied = await portalCmsAccess(request, true);
  if (denied) return denied;
  try { return portalCmsResponse({ content: await savePortalContent(await portalCmsBody(request)) }); }
  catch (error) { return portalCmsFailure(error, "Save failed."); }
}
