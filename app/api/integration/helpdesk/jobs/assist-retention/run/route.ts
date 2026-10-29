import { parseJobRunInput } from "@/contracts/helpdesk";
import { idempotencyKey, jsonResponse, problemResponse, readJsonBody, requireIntegration } from "@/modules/helpdesk/http";
import { helpdeskRetentionJob } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integration/helpdesk/jobs/assist-retention/run ({ agent: { id, name } }; Idempotency-Key) → JobRunResponse
 * (Bearer PORTAL_HELPDESK_TOKEN). Staff "run now" from the BackOffice (role-gated and audited there; the run row records
 * who asked). The same key answers with the same run; already_running when another instance holds the job.
 */
export async function POST(request: Request) {
  try {
    requireIntegration(request);
    const key = idempotencyKey(request);
    const input = parseJobRunInput(await readJsonBody(request));
    return jsonResponse(await helpdeskRetentionJob().runManual(input.agent, key));
  } catch (error) { return problemResponse(error, "jobs.run"); }
}
