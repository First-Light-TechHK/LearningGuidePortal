import { parseAgentActionInput } from "@/contracts/helpdesk";
import { idempotencyKey, jsonResponse, problemResponse, readJsonBody, requireIntegration, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskService } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/integration/helpdesk/tickets/{id}/actions ({ action: "claim"|"propose_resolution"|"flag"|"unflag", agent:{id,name}, expectedSequence } or a tag / mark_read action; Idempotency-Key) → 200 AgentTicketDetail. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireIntegration(request);
    const ticketId = await ticketIdParam(context);
    const key = idempotencyKey(request);
    const result = await helpdeskService().agentAction(ticketId, parseAgentActionInput(await readJsonBody(request)), key);
    return jsonResponse(result.ticket, 200, result.replayed);
  } catch (error) { return problemResponse(error, "agent.action"); }
}
