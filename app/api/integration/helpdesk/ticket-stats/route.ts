import { parseTicketStatsQuery } from "@/contracts/helpdesk";
import { jsonResponse, problemResponse, requireIntegration } from "@/modules/helpdesk/http";
import { helpdeskTicketStats } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integration/helpdesk/ticket-stats?from=YYYY-MM-DD&to=YYYY-MM-DD → TicketStatsResponse (Bearer PORTAL_HELPDESK_TOKEN).
 * BackOffice HelpDesk data tab: per UTC day, enquiries opened, resolved, cancelled, still open at the day's end, and the
 * first public staff reply time (median, 90th percentile). Counts and times only; read-only.
 */
export async function GET(request: Request) {
  try {
    requireIntegration(request);
    return jsonResponse(await helpdeskTicketStats().stats(parseTicketStatsQuery(new URL(request.url).searchParams)));
  } catch (error) { return problemResponse(error, "ticket-stats.read"); }
}
