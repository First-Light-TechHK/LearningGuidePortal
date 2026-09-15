import { currentCourseMediaUser } from "@/services/productAuth";
import { isAdminHost } from "@/services/adminHost";
import { courseMediaErrorResponse, serveCourseMedia } from "@/services/courseMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ courseId: string; assetId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const user = await currentCourseMediaUser(request);
    const { courseId, assetId } = await params;
    return await serveCourseMedia(request, user, courseId, assetId, isAdminHost(request));
  } catch (error) { return courseMediaErrorResponse(error, requestId); }
}

export const HEAD = GET;
