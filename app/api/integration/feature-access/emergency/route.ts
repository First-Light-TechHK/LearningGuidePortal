import { parseEmergencyInput } from "@/contracts/student-management";
import { readJson, requireStudentIntegration, studentJson, studentProblem } from "@/modules/student-management/http";
import { setEmergencyOff } from "@/modules/student-management/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integration/feature-access/emergency ({ actor, feature, off, reason }) → FeatureSettingsResponse.
 * Emergency off switches a feature off for everyone, Allow overrides included, until it is resumed; the global
 * default and the overrides stay as they were.
 */
export async function POST(request: Request) {
  try {
    requireStudentIntegration(request);
    return studentJson(await setEmergencyOff(parseEmergencyInput(await readJson(request))));
  } catch (error) { return studentProblem(error, "feature-access.emergency"); }
}
