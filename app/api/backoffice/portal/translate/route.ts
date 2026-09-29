import { translatePortalContent } from "@/services/portalTranslate";
import { portalCmsAccess, portalCmsBody, portalCmsFailure, portalCmsResponse } from "@/services/portalCmsHttp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = await portalCmsAccess(request, true);
  if (denied) return denied;
  try {
    const body = await portalCmsBody<{ source?: string; content?: unknown }>(request);
    const source = body.source === "zh-CN" ? "zh-CN" : body.source === "en-GB" ? "en-GB" : null;
    if (!source || !body.content || typeof body.content !== "object") throw new Error("Choose a source language and provide portal content.");
    const result = await translatePortalContent(body.content as import("@/lib/portalContent").PortalContent, source);
    return portalCmsResponse(result);
  } catch (error) {
    return portalCmsFailure(error, "Translation failed.");
  }
}
