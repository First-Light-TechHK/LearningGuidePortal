import { saveCourseDraftForAuthor } from "@/services/productStore";
import { authoringActor, authoringBody, authoringFailure, authoringSuccess } from "@/services/courseAuthoringHttp";
import type { CourseDraftInput } from "@/contracts/course-authoring";

export async function PUT(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const user = await authoringActor(request, true);
    const input = await authoringBody<CourseDraftInput>(request);
    const course = await saveCourseDraftForAuthor(user.id, (await params).courseId, input);
    return authoringSuccess({ data: course });
  } catch (error) { return authoringFailure(error); }
}
