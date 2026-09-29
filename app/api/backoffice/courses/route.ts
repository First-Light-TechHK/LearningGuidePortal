import { createCourseForOperator, listCoursesForAuthor } from "@/services/productStore";
import { authoringActor, authoringBody, authoringFailure, authoringSuccess } from "@/services/courseAuthoringHttp";
import type { CourseListQuery } from "@/contracts/course-authoring";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await authoringActor(request), params = new URL(request.url).searchParams;
    const query: CourseListQuery = { search: params.get("search") || undefined, status: (params.get("status") || undefined) as CourseListQuery["status"], categoryId: params.get("categoryId") || undefined, subjectId: params.get("subjectId") || undefined, level: params.get("level") || undefined, page: params.has("page") ? Number(params.get("page")) : 1, pageSize: params.has("pageSize") ? Number(params.get("pageSize")) : 10 };
    return authoringSuccess({ ...await listCoursesForAuthor(user.id, query) });
  } catch (error) { return authoringFailure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await authoringActor(request, true);
    const body = await authoringBody<Parameters<typeof createCourseForOperator>[0]>(request);
    return authoringSuccess({ course: await createCourseForOperator(body, user.id) }, 201);
  } catch (error) { return authoringFailure(error); }
}
