import type { KnowledgeResponse, KnowledgeResult } from "@/contracts/knowledge-test";

/** Local sample self-assessment; never grants course access or writes Study progress. */
export function reviewKnowledgeResponses(responses: readonly KnowledgeResponse[]): KnowledgeResult {
  const strong: number[] = [], needsReview: number[] = [];
  responses.forEach((response, index) => {
    if (response.rating === "right") strong.push(index);
    if (response.rating === "wrong") needsReview.push(index);
  });
  return { strong, needsReview, percent: responses.length ? Math.round(strong.length / responses.length * 100) : 0,
    complete: responses.length > 0 && strong.length + needsReview.length === responses.length };
}
