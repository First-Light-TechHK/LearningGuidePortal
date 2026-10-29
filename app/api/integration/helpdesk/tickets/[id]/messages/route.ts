import { parseAgentMessageInput } from "@/contracts/helpdesk";
import { idempotencyKey, jsonResponse, problemResponse, readJsonBody, requireIntegration, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskService } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/integration/helpdesk/tickets/{id}/messages ({ body, internal, agent:{id,name}, expectedSequence }; Idempotency-Key) → 201 AgentTicketDetail. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireIntegration(request);
    const ticketId = await ticketIdParam(context);
    const key = idempotencyKey(request);
    const result = await helpdeskService().postAgentMessage(ticketId, parseAgentMessageInput(await readJsonBody(request)), key);
    return jsonResponse(result.ticket, 201, result.replayed);
  } catch (error) { return problemResponse(error, "agent.message"); }
}
