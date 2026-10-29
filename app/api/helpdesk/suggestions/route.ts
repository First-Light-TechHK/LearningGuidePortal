import { parseSuggestInput } from "@/contracts/helpdesk";
import { jsonResponse, problemResponse, readJsonBody, requireLearner } from "@/modules/helpdesk/http";
import { helpdeskAssistant } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/suggestions ({ category, subject, message, locale }) → 200 { suggestion: { id, faqId, question, answer } | null, alternatives: { faqId, question }[] }.
 * The submit-time check (1333:249). Creates no ticket and sends no
 * attachments; the answer shown is logged (source submit) so the ticket can
 * link it. Any Admin failure or the 4 s timeout answers { suggestion: null }
 * so the page submits the ticket directly. v3: without a suggestion Admin may
 * offer up to 3 "You might be asking" FAQs (alternatives, [] otherwise); the
 * page shows them before it submits.
 */
export async function POST(request: Request) {
  try {
    const learner = await requireLearner(request, { write: true });
    const input = parseSuggestInput(await readJsonBody(request));
    return jsonResponse(await helpdeskAssistant(request).checkForSubmit(learner, input));
  } catch (error) { return problemResponse(error, "learner.suggest"); }
}
