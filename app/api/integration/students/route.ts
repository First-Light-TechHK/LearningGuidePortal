import { parseStudentListQuery } from "@/contracts/student-management";
import { requireStudentIntegration, studentJson, studentProblem } from "@/modules/student-management/http";
import { listStudents } from "@/modules/student-management/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integration/students?q=&status=&subscription=&special=&page=&pageSize= → StudentListResponse
 * (Bearer, Backoffice only). Learning accounts, latest registration first, with the account-state counts (PRD 3).
 */
export async function GET(request: Request) {
  try {
    requireStudentIntegration(request);
    return studentJson(await listStudents(parseStudentListQuery(new URL(request.url).searchParams)));
  } catch (error) { return studentProblem(error, "students.list"); }
}
