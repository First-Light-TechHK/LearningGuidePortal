import { jsonResponse, problemResponse, requireIntegration, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskService } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integration/helpdesk/tickets/{id} → AgentTicketDetail (all messages incl. internal notes, CloudEvents timeline). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireIntegration(request);
    return jsonResponse(await helpdeskService().getAgentTicket(await ticketIdParam(context)));
  } catch (error) { return problemResponse(error, "agent.detail"); }
}
