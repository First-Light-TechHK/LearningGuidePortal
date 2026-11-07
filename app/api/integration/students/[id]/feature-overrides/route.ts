import { parseOverridesInput } from "@/contracts/student-management";
import { readJson, requireStudentIntegration, studentIdParam, studentJson, studentProblem } from "@/modules/student-management/http";
import { saveOverrides } from "@/modules/student-management/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/integration/students/:id/feature-overrides ({ actor, reason, expectedVersion, overrides }) → StudentDetails.
 * Default removes the stored override; a stale expectedVersion is 409 version_conflict (PRD 6.2, 6.4).
 */
export async function PUT(request: Request, context: { params: Promise<Record<string, string>> }) {
  try {
    requireStudentIntegration(request);
    const id = await studentIdParam(context);
    return studentJson(await saveOverrides(id, parseOverridesInput(await readJson(request))));
  } catch (error) { return studentProblem(error, "students.overrides"); }
}
