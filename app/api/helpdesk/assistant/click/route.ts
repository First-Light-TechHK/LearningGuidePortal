import { parseAssistantClick } from "@/contracts/helpdesk";
import { idempotencyKey, jsonResponse, problemResponse, readJsonBody, requireAssistantFeature, requireLearner } from "@/modules/helpdesk/http";
import { helpdeskAssistant } from "@/modules/helpdesk/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/helpdesk/assistant/click ({ locale, nodeId, fromNodeId?, via, sessionId?, label? }; Idempotency-Key)
 * → 200 { id, reply, alternatives, turn } (Helpdesk v5, graph design §4).
 * A situation or starter chip, a follow-up chip or an A/B/C/D option. Code
 * only: Portal checks the click against its cached copy of Admin's published
 * release (a follow-up or option must be an edge of that kind from fromNodeId;
 * a chip must open an entry node), else 400 invalid_request, and shows the
 * node verbatim with the fixed opening and closing. Neither the model nor
 * Admin is asked. Before Admin has a release a chip (with its label) goes
 * through Admin's per-FAQ path as before; a follow-up or option is 400.
 * Counts toward the learner's hourly assistant budget (429 rate_limited); 403 feature_unavailable when the
 * learner's AI Support Assistant is off.
 */
export async function POST(request: Request) {
  try {
    const learner = await requireLearner(request, { write: true });
    // The same gate as a typed question (review 2026-11-03 H1): a learner whose AI Support Assistant is off
    // (override Deny, global Off or the emergency switch) gets 403 feature_unavailable here too.
    await requireAssistantFeature(learner);
    const key = idempotencyKey(request);
    const input = parseAssistantClick(await readJsonBody(request));
    const result = await helpdeskAssistant(request).click(learner, input, key);
    return jsonResponse(result.response, 200, result.replayed);
  } catch (error) { return problemResponse(error, "learner.assistant_click"); }
}
