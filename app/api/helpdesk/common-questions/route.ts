import { parseLocaleParam } from "@/contracts/helpdesk";
import { jsonResponse, problemResponse, requireLearner } from "@/modules/helpdesk/http";
import { createAdminHelpdeskClient } from "@/modules/helpdesk/adminClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/helpdesk/common-questions?locale=en-GB|zh-CN → { questions: [{ id, category, question, answer }] }.
 * Featured, published questions owned by Admin (60 s cache, stale on error);
 * an empty list means the column is hidden.
 */
export async function GET(request: Request) {
  try {
    await requireLearner(request);
    const locale = parseLocaleParam(new URL(request.url).searchParams);
    const questions = await createAdminHelpdeskClient().commonQuestions(locale);
    return jsonResponse({ questions: questions ?? [] });
  } catch (error) { return problemResponse(error, "learner.common_questions"); }
}
