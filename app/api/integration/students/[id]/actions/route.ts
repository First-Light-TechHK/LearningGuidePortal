import { parseStudentActionInput } from "@/contracts/student-management";
import { readJson, requireStudentIntegration, studentIdParam, studentJson, studentProblem } from "@/modules/student-management/http";
import { runStudentAction } from "@/modules/student-management/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integration/students/:id/actions ({ action, actor, ... }) → { student, email }.
 * deactivate / activate (reason), change_email (email, reason, exemption?), resend_verification, send_password_link
 * (PRD 4.2, 5). Each is its own confirmed action, never part of an access save.
 */
export async function POST(request: Request, context: { params: Promise<Record<string, string>> }) {
  try {
    requireStudentIntegration(request);
    const id = await studentIdParam(context);
    return studentJson(await runStudentAction(id, parseStudentActionInput(await readJson(request)), request));
  } catch (error) { return studentProblem(error, "students.action"); }
}
