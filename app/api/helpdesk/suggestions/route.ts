import { parseSuggestInput } from "@/contracts/helpdesk";
import { jsonResponse, problemResponse, readJsonBody, requireLearner } from "@/modules/helpdesk/http";
import { helpdeskAssistant } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/suggestions ({ category, subject, message, locale }) → 200 { suggestion: { id, faqId, question, answer } | null }.
 * The submit-time check (1333:249). Creates no ticket and sends no
 * attachments; the answer shown is logged (source submit) so the ticket can
 * link it. Any Admin failure or the 4 s timeout answers { suggestion: null }
 * so the page submits the ticket directly.
 */
export async function POST(request: Request) {
  try {
    const learner = await requireLearner(request, { write: true });
    const input = parseSuggestInput(await readJsonBody(request));
    return jsonResponse({ suggestion: await helpdeskAssistant().suggestForSubmit(learner, input) });
  } catch (error) { return problemResponse(error, "learner.suggest"); }
}
