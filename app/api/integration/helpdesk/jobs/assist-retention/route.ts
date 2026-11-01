import { jsonResponse, problemResponse, requireIntegration } from "@/modules/helpdesk/http";
import { helpdeskRetentionJob } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integration/helpdesk/jobs/assist-retention → JobRunsResponse, the newest 20 runs (Bearer PORTAL_HELPDESK_TOKEN). */
export async function GET(request: Request) {
  try {
    requireIntegration(request);
    return jsonResponse(await helpdeskRetentionJob().listRuns());
  } catch (error) { return problemResponse(error, "jobs.list"); }
}
