import { parseSuggestInput } from "@/contracts/helpdesk";
import { jsonResponse, problemResponse, readJsonBody, requireLearner } from "@/modules/helpdesk/http";
import { createAdminHelpdeskClient } from "@/modules/helpdesk/adminClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/suggestions ({ category, subject, message, locale }) → 200 { suggestion: { id, qaId, question, answer } | null }.
 * Creates no ticket and sends no attachments. Any Admin failure or the 4 s
 * timeout answers { suggestion: null } so the page submits the ticket directly.
 */
export async function POST(request: Request) {
  try {
    const learner = await requireLearner(request, { write: true });
    const input = parseSuggestInput(await readJsonBody(request));
    return jsonResponse({ suggestion: await createAdminHelpdeskClient().suggest({ ...input, learnerId: learner.id }) });
  } catch (error) { return problemResponse(error, "learner.suggest"); }
}
