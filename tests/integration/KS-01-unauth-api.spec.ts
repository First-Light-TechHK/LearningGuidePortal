import { expect, test } from "playwright/test";
import { NextRequest } from "next/server";
import { POST as chatPost } from "../../app/api/chat/route";
import { POST as openrouterPost } from "../../app/api/benchmark/openrouter/route";
import { GET as coursesGet, POST as coursesPost } from "../../app/api/courses/route";
import { PUT as coursePut, DELETE as courseDelete } from "../../app/api/courses/[courseId]/route";
import { GET as knowledgeGet, POST as knowledgePost } from "../../app/api/courses/[courseId]/knowledge/route";
import { PUT as knowledgePut, DELETE as knowledgeDelete } from "../../app/api/courses/[courseId]/knowledge/[knowledgeId]/route";
import { POST as wikiPublishPost } from "../../app/api/wiki/publish/route";
import { GET as wikiTreeGet, POST as wikiTreePost } from "../../app/api/wiki/tree/route";
import { GET as wikiPublishedGet } from "../../app/api/wiki/published/route";
import { GET as wikiPagesGet, POST as wikiPagesPost } from "../../app/api/wiki/pages/route";
import { GET as wikiPageGet } from "../../app/api/wiki/pages/[pageId]/route";
import { POST as wikiEntryPost } from "../../app/api/wiki/pages/[pageId]/entries/route";
import { PUT as wikiEntryPut, DELETE as wikiEntryDelete } from "../../app/api/wiki/pages/[pageId]/entries/[entryId]/route";
import { GET as wikiRefsGet, DELETE as wikiRefsDelete } from "../../app/api/wiki/source-references/route";
import { POST as wikiSourceMaterialsPost } from "../../app/api/wiki/source-materials/route";
import { POST as wikiDraftPost } from "../../app/api/wiki/draft/route";
import { GET as wikiCommentsGet, POST as wikiCommentsPost, DELETE as wikiCommentsDelete } from "../../app/api/wiki/comments/route";
import { POST as wikiImportPost } from "../../app/api/wiki/import-source-output-to-wiki/route";
import { POST as wikiApplyPost } from "../../app/api/wiki/apply-incremental/route";
import { GET as navigationGet } from "../../app/api/navigation/route";
import { GET as draftGet } from "../../app/api/draft/route";
import { POST as draftModelPost } from "../../app/api/draft/model/route";
import { POST as draftGeneratePost } from "../../app/api/draft/generate/route";
import { POST as draftIncrementalPost } from "../../app/api/draft/incremental-generate/route";
import { POST as draftImportPost } from "../../app/api/draft/import-source/route";
import { POST as draftSavePost } from "../../app/api/draft/save-output/route";
import { POST as draftCreateWikiPost } from "../../app/api/draft/create-wiki/route";
import { POST as draftUpdateWikiPost } from "../../app/api/draft/update-wiki/route";
import { GET as dialogueGet } from "../../app/api/dialogue/route";
import { POST as dialogueSendPost } from "../../app/api/dialogue/send/route";
import { POST as dialogueResetPost } from "../../app/api/dialogue/reset/route";
import { GET as dialogueAssessmentGet, POST as dialogueAssessmentPost } from "../../app/api/dialogue/assessment/route";
import { GET as dialogueTestingGet } from "../../app/api/dialogue-testing/route";
import { POST as dialogueTestingSendPost } from "../../app/api/dialogue-testing/send/route";
import { POST as dialogueTestingResetPost } from "../../app/api/dialogue-testing/reset/route";
import { POST as dialogueTestingConfigPost } from "../../app/api/dialogue-testing/config/route";
import { POST as dialogueTestingImportPost } from "../../app/api/dialogue-testing/import-knowledge/route";
import { GET as chatTestingGet } from "../../app/api/chat-testing/route";
import { POST as chatTestingPromptsPost } from "../../app/api/chat-testing/prompts/route";
import { POST as chatTestingRoutesPost } from "../../app/api/chat-testing/routes/route";
import { POST as chatTestingRunPost } from "../../app/api/chat-testing/run/route";
import { POST as chatTestingRunRoutePost } from "../../app/api/chat-testing/run-route/route";
import { POST as chatTestingSaveRunPost } from "../../app/api/chat-testing/save-run/route";
import { GET as sourceMaterialsGet, POST as sourceMaterialsPost } from "../../app/api/source-materials/route";
import { POST as sourceFilesPost, DELETE as sourceFilesDelete } from "../../app/api/source-materials/files/route";
import { POST as sourceQaPost } from "../../app/api/source-materials/qa-notes/route";
import { POST as sourceVideosPost } from "../../app/api/source-materials/videos/route";
import { DELETE as sourceVideoDelete } from "../../app/api/source-materials/videos/[id]/route";
import { POST as sourceTranscriptPost } from "../../app/api/source-materials/videos/[id]/transcript/route";
import { GET as sourceTranscriptDownloadGet } from "../../app/api/source-materials/transcripts/download/route";
import { GET as releasesGet, POST as releasesPost } from "../../app/api/releases/route";
import { DELETE as releaseDelete } from "../../app/api/releases/[releaseId]/route";
import { GET as releaseDownloadGet } from "../../app/api/releases/[releaseId]/download/route";
import { POST as extractMaterialPost } from "../../app/api/extract-material/route";
import { POST as knowledgeDraftPost } from "../../app/api/knowledge-draft/route";
import { POST as llmDraftImportPost } from "../../app/api/llm-draft/import-source-output/route";

// Break: removing a session gate so an unauthenticated KS read/write/LLM
// call returns 200/400/500 instead of 401.

const originalKey = process.env.OPENROUTER_API_KEY;
const missing = {
  params: Promise.resolve({
    courseId: "ks01-missing",
    knowledgeId: "ks01-missing",
    pageId: "ks01-missing",
    entryId: "ks01-missing",
    id: "ks01-missing",
    releaseId: "ks01-missing"
  })
};

test.beforeAll(() => {
  delete process.env.OPENROUTER_API_KEY;
});

test.afterAll(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
});

function unauth(method: string, url: string, body?: unknown) {
  if (body === "form") return new NextRequest(url, { method });
  if (body === undefined) return new NextRequest(url, { method });
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

const chatBody = {
  model: "test-model",
  mode: "lecture" as const,
  message: "hello",
  history: [],
  prompts: { base: "base", lecture: "lecture", socratic: "socratic" },
  knowledgePack: {},
  sources: ""
};

const alreadyGated = [
  { name: "POST /api/chat", call: () => chatPost(unauth("POST", "http://localhost/api/chat", chatBody)) },
  { name: "POST /api/benchmark/openrouter", call: () => openrouterPost(unauth("POST", "http://localhost/api/benchmark/openrouter", { model: "test-model", messages: [{ role: "user", content: "hello" }] })) },
  { name: "POST /api/courses", call: () => coursesPost(unauth("POST", "http://localhost/api/courses", {})) },
  { name: "POST /api/wiki/publish", call: () => wikiPublishPost(unauth("POST", "http://localhost/api/wiki/publish", {})) }
];

const remaining = [
  { name: "GET /api/courses", call: () => coursesGet(unauth("GET", "http://localhost/api/courses")) },
  { name: "PUT /api/courses/[courseId]", call: () => coursePut(unauth("PUT", "http://localhost/api/courses/ks01-missing", {}), missing) },
  { name: "DELETE /api/courses/[courseId]", call: () => courseDelete(unauth("DELETE", "http://localhost/api/courses/ks01-missing"), missing) },
  { name: "GET /api/courses/[courseId]/knowledge", call: () => knowledgeGet(unauth("GET", "http://localhost/api/courses/ks01-missing/knowledge"), missing) },
  { name: "POST /api/courses/[courseId]/knowledge", call: () => knowledgePost(unauth("POST", "http://localhost/api/courses/ks01-missing/knowledge", {}), missing) },
  { name: "PUT /api/courses/[courseId]/knowledge/[knowledgeId]", call: () => knowledgePut(unauth("PUT", "http://localhost/api/courses/ks01-missing/knowledge/ks01-missing", {}), missing) },
  { name: "DELETE /api/courses/[courseId]/knowledge/[knowledgeId]", call: () => knowledgeDelete(unauth("DELETE", "http://localhost/api/courses/ks01-missing/knowledge/ks01-missing"), missing) },
  { name: "GET /api/wiki/tree", call: () => wikiTreeGet(unauth("GET", "http://localhost/api/wiki/tree")) },
  { name: "POST /api/wiki/tree", call: () => wikiTreePost(unauth("POST", "http://localhost/api/wiki/tree", {})) },
  { name: "GET /api/wiki/published", call: () => wikiPublishedGet(unauth("GET", "http://localhost/api/wiki/published")) },
  { name: "GET /api/wiki/pages", call: () => wikiPagesGet(unauth("GET", "http://localhost/api/wiki/pages")) },
  { name: "POST /api/wiki/pages", call: () => wikiPagesPost(unauth("POST", "http://localhost/api/wiki/pages", {})) },
  { name: "GET /api/wiki/pages/[pageId]", call: () => wikiPageGet(unauth("GET", "http://localhost/api/wiki/pages/ks01-missing"), missing) },
  { name: "POST /api/wiki/pages/[pageId]/entries", call: () => wikiEntryPost(unauth("POST", "http://localhost/api/wiki/pages/ks01-missing/entries", {}), missing) },
  { name: "PUT /api/wiki/pages/[pageId]/entries/[entryId]", call: () => wikiEntryPut(unauth("PUT", "http://localhost/api/wiki/pages/ks01-missing/entries/ks01-missing", {}), missing) },
  { name: "DELETE /api/wiki/pages/[pageId]/entries/[entryId]", call: () => wikiEntryDelete(unauth("DELETE", "http://localhost/api/wiki/pages/ks01-missing/entries/ks01-missing"), missing) },
  { name: "GET /api/wiki/source-references", call: () => wikiRefsGet(unauth("GET", "http://localhost/api/wiki/source-references")) },
  { name: "DELETE /api/wiki/source-references", call: () => wikiRefsDelete(unauth("DELETE", "http://localhost/api/wiki/source-references", {})) },
  { name: "POST /api/wiki/source-materials", call: () => wikiSourceMaterialsPost(unauth("POST", "http://localhost/api/wiki/source-materials", "form")) },
  { name: "POST /api/wiki/draft", call: () => wikiDraftPost(unauth("POST", "http://localhost/api/wiki/draft", {})) },
  { name: "GET /api/wiki/comments", call: () => wikiCommentsGet(unauth("GET", "http://localhost/api/wiki/comments")) },
  { name: "POST /api/wiki/comments", call: () => wikiCommentsPost(unauth("POST", "http://localhost/api/wiki/comments", {})) },
  { name: "DELETE /api/wiki/comments", call: () => wikiCommentsDelete(unauth("DELETE", "http://localhost/api/wiki/comments", {})) },
  { name: "POST /api/wiki/import-source-output-to-wiki", call: () => wikiImportPost(unauth("POST", "http://localhost/api/wiki/import-source-output-to-wiki", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/wiki/apply-incremental", call: () => wikiApplyPost(unauth("POST", "http://localhost/api/wiki/apply-incremental", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "GET /api/navigation", call: () => navigationGet(unauth("GET", "http://localhost/api/navigation")) },
  { name: "GET /api/draft", call: () => draftGet(unauth("GET", "http://localhost/api/draft?courseId=ks01-missing&knowledgeId=ks01-missing")) },
  { name: "POST /api/draft/model", call: () => draftModelPost(unauth("POST", "http://localhost/api/draft/model", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/draft/generate", call: () => draftGeneratePost(unauth("POST", "http://localhost/api/draft/generate", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/draft/incremental-generate", call: () => draftIncrementalPost(unauth("POST", "http://localhost/api/draft/incremental-generate", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/draft/import-source", call: () => draftImportPost(unauth("POST", "http://localhost/api/draft/import-source", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/draft/save-output", call: () => draftSavePost(unauth("POST", "http://localhost/api/draft/save-output", {})) },
  { name: "POST /api/draft/create-wiki", call: () => draftCreateWikiPost(unauth("POST", "http://localhost/api/draft/create-wiki", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/draft/update-wiki", call: () => draftUpdateWikiPost(unauth("POST", "http://localhost/api/draft/update-wiki", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "GET /api/dialogue", call: () => dialogueGet(unauth("GET", "http://localhost/api/dialogue?courseId=ks01-missing&knowledgeId=ks01-missing")) },
  { name: "POST /api/dialogue/send", call: () => dialogueSendPost(unauth("POST", "http://localhost/api/dialogue/send", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/dialogue/reset", call: () => dialogueResetPost(unauth("POST", "http://localhost/api/dialogue/reset", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "GET /api/dialogue/assessment", call: () => dialogueAssessmentGet(unauth("GET", "http://localhost/api/dialogue/assessment?courseId=ks01-missing&knowledgeId=ks01-missing")) },
  { name: "POST /api/dialogue/assessment", call: () => dialogueAssessmentPost(unauth("POST", "http://localhost/api/dialogue/assessment", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "GET /api/dialogue-testing", call: () => dialogueTestingGet(unauth("GET", "http://localhost/api/dialogue-testing?courseId=ks01-missing&knowledgeId=ks01-missing")) },
  { name: "POST /api/dialogue-testing/send", call: () => dialogueTestingSendPost(unauth("POST", "http://localhost/api/dialogue-testing/send", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/dialogue-testing/reset", call: () => dialogueTestingResetPost(unauth("POST", "http://localhost/api/dialogue-testing/reset", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/dialogue-testing/config", call: () => dialogueTestingConfigPost(unauth("POST", "http://localhost/api/dialogue-testing/config", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/dialogue-testing/import-knowledge", call: () => dialogueTestingImportPost(unauth("POST", "http://localhost/api/dialogue-testing/import-knowledge", "form")) },
  { name: "GET /api/chat-testing", call: () => chatTestingGet(unauth("GET", "http://localhost/api/chat-testing?courseId=ks01-missing&knowledgeId=ks01-missing")) },
  { name: "POST /api/chat-testing/prompts", call: () => chatTestingPromptsPost(unauth("POST", "http://localhost/api/chat-testing/prompts", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/chat-testing/routes", call: () => chatTestingRoutesPost(unauth("POST", "http://localhost/api/chat-testing/routes", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/chat-testing/run", call: () => chatTestingRunPost(unauth("POST", "http://localhost/api/chat-testing/run", {})) },
  { name: "POST /api/chat-testing/run-route", call: () => chatTestingRunRoutePost(unauth("POST", "http://localhost/api/chat-testing/run-route", {})) },
  { name: "POST /api/chat-testing/save-run", call: () => chatTestingSaveRunPost(unauth("POST", "http://localhost/api/chat-testing/save-run", {})) },
  { name: "GET /api/source-materials", call: () => sourceMaterialsGet(unauth("GET", "http://localhost/api/source-materials?courseId=ks01-missing&knowledgeId=ks01-missing")) },
  { name: "POST /api/source-materials", call: () => sourceMaterialsPost(unauth("POST", "http://localhost/api/source-materials", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/source-materials/files", call: () => sourceFilesPost(unauth("POST", "http://localhost/api/source-materials/files", "form")) },
  { name: "DELETE /api/source-materials/files", call: () => sourceFilesDelete(unauth("DELETE", "http://localhost/api/source-materials/files", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "POST /api/source-materials/qa-notes", call: () => sourceQaPost(unauth("POST", "http://localhost/api/source-materials/qa-notes", "form")) },
  { name: "POST /api/source-materials/videos", call: () => sourceVideosPost(unauth("POST", "http://localhost/api/source-materials/videos", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "DELETE /api/source-materials/videos/[id]", call: () => sourceVideoDelete(unauth("DELETE", "http://localhost/api/source-materials/videos/ks01-missing?courseId=ks01-missing&knowledgeId=ks01-missing"), missing) },
  { name: "POST /api/source-materials/videos/[id]/transcript", call: () => sourceTranscriptPost(unauth("POST", "http://localhost/api/source-materials/videos/ks01-missing/transcript", { courseId: "ks01-missing", knowledgeId: "ks01-missing" }), missing) },
  { name: "GET /api/source-materials/transcripts/download", call: () => sourceTranscriptDownloadGet(unauth("GET", "http://localhost/api/source-materials/transcripts/download?courseId=ks01-missing&knowledgeId=ks01-missing&path=missing.md")) },
  { name: "GET /api/releases", call: () => releasesGet(unauth("GET", "http://localhost/api/releases?courseId=ks01-missing&knowledgeId=ks01-missing")) },
  { name: "POST /api/releases", call: () => releasesPost(unauth("POST", "http://localhost/api/releases", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) },
  { name: "DELETE /api/releases/[releaseId]", call: () => releaseDelete(unauth("DELETE", "http://localhost/api/releases/ks01-missing?courseId=ks01-missing&knowledgeId=ks01-missing"), missing) },
  { name: "GET /api/releases/[releaseId]/download", call: () => releaseDownloadGet(unauth("GET", "http://localhost/api/releases/ks01-missing/download?courseId=ks01-missing&knowledgeId=ks01-missing"), missing) },
  { name: "POST /api/extract-material", call: () => extractMaterialPost(unauth("POST", "http://localhost/api/extract-material", "form")) },
  { name: "POST /api/knowledge-draft", call: () => knowledgeDraftPost(unauth("POST", "http://localhost/api/knowledge-draft", { model: "test-model", material: "" })) },
  { name: "POST /api/llm-draft/import-source-output", call: () => llmDraftImportPost(unauth("POST", "http://localhost/api/llm-draft/import-source-output", { courseId: "ks01-missing", knowledgeId: "ks01-missing" })) }
];

for (const row of alreadyGated) {
  test(`unauthenticated ${row.name} returns 401`, async () => {
    expect((await row.call()).status).toBe(401);
  });
}

for (const row of remaining) {
  test(`unauthenticated ${row.name} returns 401`, async () => {
    expect((await row.call()).status).toBe(401);
  });
}
