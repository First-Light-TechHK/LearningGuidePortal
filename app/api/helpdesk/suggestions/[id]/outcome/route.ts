import { HelpdeskProblem, parseSuggestionOutcome } from "@/contracts/helpdesk";
import { problemResponse, readJsonBody, requireLearner, ticketIdParam } from "@/modules/helpdesk/http";
import { createAdminHelpdeskClient } from "@/modules/helpdesk/adminClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/suggestions/{id}/outcome ({ outcome: "solved"|"declined"|"edited" }) → 204.
 * Forwarded to Admin (idempotent there: the first outcome wins). 503
 * assistant_unavailable when Admin could not be told; pages ignore it.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireLearner(request, { write: true });
    const suggestionId = await ticketIdParam(context);
    const outcome = parseSuggestionOutcome(await readJsonBody(request));
    if (!(await createAdminHelpdeskClient().reportOutcome(suggestionId, outcome))) throw new HelpdeskProblem("assistant_unavailable");
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return problemResponse(error, "learner.suggestion_outcome"); }
}
