import { jsonResponse, problemResponse, requireLearner, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskAssistant } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/assistant/{id}/expanded → 200 { id, expanded: true } (Helpdesk v5 Part H). The learner opened
 * "show the full answer" under an excerpt of one of their own answers; logged once (a sign the excerpt was too short).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const learner = await requireLearner(request, { write: true });
    const id = await ticketIdParam(context);
    return jsonResponse(await helpdeskAssistant(request).expand(learner, id));
  } catch (error) { return problemResponse(error, "learner.assistant_expanded"); }
}
