import { parseFeatureSettingsInput } from "@/contracts/student-management";
import { readJson, requireStudentIntegration, studentJson, studentProblem } from "@/modules/student-management/http";
import { getFeatureSettings, saveFeatureSettings } from "@/modules/student-management/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integration/feature-access → FeatureSettingsResponse (Bearer, Backoffice only; PRD 7). */
export async function GET(request: Request) {
  try {
    requireStudentIntegration(request);
    return studentJson(await getFeatureSettings());
  } catch (error) { return studentProblem(error, "feature-access.read"); }
}

/** PUT /api/integration/feature-access ({ actor, reason, expectedVersion, features }) → FeatureSettingsResponse; all changes in one save. */
export async function PUT(request: Request) {
  try {
    requireStudentIntegration(request);
    return studentJson(await saveFeatureSettings(parseFeatureSettingsInput(await readJson(request))));
  } catch (error) { return studentProblem(error, "feature-access.save"); }
}
