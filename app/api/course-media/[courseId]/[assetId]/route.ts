import { currentProductUserFromRequest } from "@/services/productAuth";
import { courseMediaErrorResponse, serveCourseMedia } from "@/services/courseMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ courseId: string; assetId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const user = await currentProductUserFromRequest(request);
    const { courseId, assetId } = await params;
    return await serveCourseMedia(request, user, courseId, assetId);
  } catch (error) { return courseMediaErrorResponse(error, requestId); }
}

export const HEAD = GET;
