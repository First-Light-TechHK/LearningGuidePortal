import { parseSuggestionOutcome } from "@/contracts/helpdesk";
import { problemResponse, readJsonBody, requireLearner, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskAssistant } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/suggestions/{id}/outcome ({ outcome: "solved"|"declined"|"edited" }) → 204.
 * Stored on the learner's logged suggestion (first outcome wins; the
 * BackOffice shows it) and forwarded to Admin, which also keeps the first.
 * 404 for a suggestion this learner was never shown. Admin being down does
 * not fail the call: Portal's record is kept.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const learner = await requireLearner(request, { write: true });
    const suggestionId = await ticketIdParam(context);
    const outcome = parseSuggestionOutcome(await readJsonBody(request));
    await helpdeskAssistant().submitOutcome(learner, suggestionId, outcome);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return problemResponse(error, "learner.suggestion_outcome"); }
}
