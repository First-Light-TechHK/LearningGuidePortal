import { parseAssistantRating } from "@/contracts/helpdesk";
import { idempotencyKey, jsonResponse, problemResponse, readJsonBody, requireLearner, ticketIdParam } from "@/modules/helpdesk/http";
import { helpdeskAssistant } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/assistant/{id}/rating ({ rating: 1..5 }; Idempotency-Key) → 200 { id, rating }.
 * The AI service rating card (helpdesk-v3-alternatives-rating §2), shown
 * after "Yes, this solved my issue": id is the answer the learner was shown
 * (the submit-time suggestion or a chosen alternative's answer). One rating
 * per answer: the first wins, a repeat with the same value answers 200 with
 * it, a different value is 409 answer_already_rated (RFC 9457, with the
 * stored rating). 404 for an answer this learner was never shown, or a
 * fallback with no answer. Skip sends nothing. Same auth as feedback.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const learner = await requireLearner(request, { write: true });
    const id = await ticketIdParam(context);
    idempotencyKey(request);
    const rating = parseAssistantRating(await readJsonBody(request));
    return jsonResponse(await helpdeskAssistant(request).rate(learner, id, rating));
  } catch (error) { return problemResponse(error, "learner.assistant_rating"); }
}
