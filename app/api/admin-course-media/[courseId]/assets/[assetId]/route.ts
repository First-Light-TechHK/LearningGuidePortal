import { currentProductUserFromRequest } from "@/services/productAuth";
import { adminMediaErrorResponse, proxyAdminCourseMedia } from "@/services/adminCourseMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ courseId: string; assetId: string }> }) {
  try {
    const user = await currentProductUserFromRequest(request);
    const { courseId, assetId } = await params;
    return await proxyAdminCourseMedia(request, user, "asset", courseId, assetId);
  } catch (error) {
    return adminMediaErrorResponse(error);
  }
}

export const HEAD = GET;
