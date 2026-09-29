import { addLessonToCourse, getCourseForAuthor, setCourseStatus, type ProductCourse } from "@/services/productStore";
import { authoringActor, authoringBody, authoringFailure, authoringSuccess } from "@/services/courseAuthoringHttp";

type Context = { params: Promise<{ courseId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await authoringActor(request);
    return authoringSuccess({ course: await getCourseForAuthor(user.id, (await params).courseId) });
  } catch (error) { return authoringFailure(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await authoringActor(request, true);
    const body = await authoringBody<{ status: ProductCourse["status"]; expectedUpdatedAt: string }>(request);
    return authoringSuccess({ course: await setCourseStatus((await params).courseId, body.status, user.id, body.expectedUpdatedAt) });
  } catch (error) { return authoringFailure(error); }
}

// DELETE archives the aggregate; purchases, historical progress and KS identities remain intact.
export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await authoringActor(request, true);
    const body = await authoringBody<{ expectedUpdatedAt: string }>(request);
    return authoringSuccess({ course: await setCourseStatus((await params).courseId, "archived", user.id, body.expectedUpdatedAt) });
  } catch (error) { return authoringFailure(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await authoringActor(request, true);
    const body = await authoringBody<Parameters<typeof addLessonToCourse>[0]>(request);
    return authoringSuccess({ lesson: await addLessonToCourse({ ...body, courseId: (await params).courseId }, user.id) }, 201);
  } catch (error) { return authoringFailure(error); }
}
