import { requireStudentIntegration, studentIdParam, studentJson, studentProblem } from "@/modules/student-management/http";
import { getStudent } from "@/modules/student-management/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integration/students/:id → StudentDetails (Bearer, Backoffice only; PRD 4). */
export async function GET(request: Request, context: { params: Promise<Record<string, string>> }) {
  try {
    requireStudentIntegration(request);
    return studentJson(await getStudent(await studentIdParam(context)));
  } catch (error) { return studentProblem(error, "students.read"); }
}
