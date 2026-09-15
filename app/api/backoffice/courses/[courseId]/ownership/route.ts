import { assignCourseOwner } from "@/services/productStore";
import { authoringActor, authoringBody, authoringFailure, authoringSuccess } from "@/services/courseAuthoringHttp";

export async function PUT(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const user = await authoringActor(request, true);
    const input = await authoringBody<{ email: string; expectedUpdatedAt: string }>(request);
    return authoringSuccess({ course: await assignCourseOwner(user.id, (await params).courseId, input) });
  } catch (error) { return authoringFailure(error); }
}
