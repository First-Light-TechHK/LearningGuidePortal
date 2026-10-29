import { parseAgentListQuery } from "@/contracts/helpdesk";
import { jsonResponse, problemResponse, requireIntegration } from "@/modules/helpdesk/http";
import { helpdeskService } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integration/helpdesk/tickets?status=&q=&category=&tag=&flagged=true&learnerId=&limit=&cursor= → { tickets: AgentTicketSummary[], nextCursor, counts } (Bearer PORTAL_HELPDESK_TOKEN). */
export async function GET(request: Request) {
  try {
    requireIntegration(request);
    return jsonResponse(await helpdeskService().listAgentTickets(parseAgentListQuery(new URL(request.url).searchParams)));
  } catch (error) { return problemResponse(error, "agent.list"); }
}
