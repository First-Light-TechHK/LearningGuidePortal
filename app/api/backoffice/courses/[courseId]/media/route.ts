import { currentProductUserFromRequest } from "@/services/productAuth";
import { assertMediaUploadOrigin, courseMediaErrorResponse, readCourseMediaUpload, requireCourseMediaManager, uploadCourseMedia } from "@/services/courseMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const user = await currentProductUserFromRequest(request);
    const { courseId } = await params;
    assertMediaUploadOrigin(request);
    await requireCourseMediaManager(user, courseId);
    const { file, usage } = await readCourseMediaUpload(request);
    const data = await uploadCourseMedia(user, courseId, file, usage);
    return Response.json({ ok: true, data, requestId }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return courseMediaErrorResponse(error, requestId); }
}
