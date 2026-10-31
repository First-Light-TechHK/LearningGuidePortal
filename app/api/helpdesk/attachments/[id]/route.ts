import { attachmentResponse, problemResponse, requireLearner, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskService } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/helpdesk/attachments/{id} → image bytes (owner only; Cache-Control: private, no-store). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const learner = await requireLearner(request);
    return attachmentResponse(await helpdeskService().readLearnerAttachment(learner, await ticketIdParam(context)));
  } catch (error) { return problemResponse(error, "learner.attachment"); }
}
