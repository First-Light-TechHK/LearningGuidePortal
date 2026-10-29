import { attachmentResponse, problemResponse, requireIntegration, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskService } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integration/helpdesk/attachments/{id} → image bytes for the Admin server proxy. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireIntegration(request);
    return attachmentResponse(await helpdeskService().readAgentAttachment(await ticketIdParam(context)));
  } catch (error) { return problemResponse(error, "agent.attachment"); }
}
