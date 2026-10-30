import { parseInsightsQuery } from "@/contracts/helpdesk";
import { jsonResponse, problemResponse, requireIntegration } from "@/modules/helpdesk/http";
import { helpdeskInsights } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integration/helpdesk/insights?since=&until=&cursor=&limit= → InsightsPage (Bearer PORTAL_HELPDESK_TOKEN).
 * v5 Part G2: every assist turn, oldest first, the learner's words scrubbed by code and the labels as enum names;
 * read-only, and a cursor keeps its window, so the same request answers the same page.
 */
export async function GET(request: Request) {
  try {
    requireIntegration(request);
    return jsonResponse(await helpdeskInsights().page(parseInsightsQuery(new URL(request.url).searchParams)));
  } catch (error) { return problemResponse(error, "insights.list"); }
}
