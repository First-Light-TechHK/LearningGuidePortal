// Local OpenAI-compatible tutor mock for the Study Group two-browser E2E test.
// Serves the minimal surface modules/group-study/tutorAnswer.ts parses:
//   - POST /v1/chat/completions -> { choices: [{ message: { content } }] }
// The reply follows the tutor reply contract: the first line is the mode tag
// (stripped before publish), the rest deliberately mentions "the course text"
// so assertions can pin the visible message text.
// Markers in the question drive the QA regression E2E: "[slow]" answers after
// SLOW_MS (an answer still in progress), "[fail]" answers HTTP 500 (a model
// failure), "[markdown]" answers with emphasis and identifiers the reply
// cleaning must tell apart (QA 2026-10-19 M22).
// Tutor infra 2026-10-20 markers: "[quiz]" answers with an understanding
// check (the QUIZ tag); "[gone]" answers 404 "No endpoints found" for the
// first model of the list (GONE_MODEL), as OpenRouter does for a retired
// model, and normally for any other, so the reply proves the fallback;
// "[followup]" answers from the room_context block the server sends; "[tool]"
// asks for get_room_history when tools are offered and answers from the tool
// result on the next call.
// KnowledgeSystem surface (the room Tutor goes through KS since 2026-10-23,
// services/ksTutorClient.ts): GET /api/user/ai-tutors lists the E2E course as
// online, and POST /api/user/ai/chat-stream answers as SSE {delta} frames.
// KS replies carry no mode tag. "[latex]" answers with inline and display
// LaTeX, a list and a source citation (owner 2026-10-29: the room renders the
// model's LaTeX); "[fail]" answers HTTP 500; anything else gets KS_REPLY.
import { createServer } from "node:http";

const PORT = Number(process.env.STUDYGROUP_TUTOR_MOCK_PORT || 8788);
const HOST = "127.0.0.1";
const REPLY = "COURSE\nMock tutor reply: the course text explains this topic.";
const MARKDOWN_REPLY = "COURSE\nUse x_1 and snake_case_name; 2*3*4 = 24 is the **key** point.";
const KS_COURSES = (process.env.STUDYGROUP_TUTOR_MOCK_KS_COURSES || "epicureanism").split(",");
const KS_REPLY = "Mock tutor reply: the course text explains this topic.";
const LATEX_REPLY = "The basic derivatives are \\(\\frac{d}{dx}x^n = nx^{n-1}\\) and $(e^x)' = e^x$.\n$$\n\\lim_{\\Delta t \\to 0} \\frac{X(t+\\Delta t)-X(t)}{\\Delta t}\n$$\n- Chain rule: $f(g(t))' = f'(g(t))\\,g'(t)$\n- Product rule [Source: Modeling Life - 2.2]";
const SLOW_MS = Number(process.env.STUDYGROUP_TUTOR_MOCK_SLOW_MS || 8000);
const GONE_MODEL = process.env.STUDYGROUP_TUTOR_MOCK_GONE_MODEL || "anthropic/claude-haiku-5.5";

// The participant's own text and the room context out of the server's user
// message (tutorUserMessage); a bare message is the participant text.
function section(content, tag) {
  const match = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(content);
  return match ? match[1] : null;
}

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || HOST}`);
  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/user/ai-tutors") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: KS_COURSES.map((externalId) => ({ externalId, available: true, online: true })) }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/user/ai/chat-stream") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      let message = "";
      try {
        message = String(JSON.parse(body).message || "");
      } catch {
        message = "";
      }
      console.log(`studygroup-tutor-mock: POST /api/user/ai/chat-stream question=${JSON.stringify(message.slice(0, 160))}`);
      if (message.includes("[fail]")) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: "MOCK_FAILURE", message: "mock model failure" }));
        return;
      }
      const reply = message.includes("[latex]") ? LATEX_REPLY : message.includes("[markdown]") ? MARKDOWN_REPLY.replace(/^COURSE\n/, "") : KS_REPLY;
      const send = () => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        for (let index = 0; index < reply.length; index += 40) response.write(`data: ${JSON.stringify({ delta: reply.slice(index, index + 40) })}\n\n`);
        response.end(`data: ${JSON.stringify({ done: true })}\n\n`);
      };
      setTimeout(send, message.includes("[slow]") ? SLOW_MS : 0);
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = {};
      }
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const user = String(messages.find((message) => message.role === "user")?.content || "");
      const question = section(user, "participant_text") ?? user;
      const roomContext = section(user, "room_context") ?? "";
      const toolResult = messages.find((message) => message.role === "tool");
      const tools = Array.isArray(parsed.tools) ? parsed.tools.map((tool) => tool?.function?.name) : [];
      const model = String(parsed.model || "");
      console.log(`studygroup-tutor-mock: POST /v1/chat/completions bytes=${body.length} model=${JSON.stringify(model)} tools=${tools.length} question=${JSON.stringify(question.slice(0, 160))}`);
      if (question.includes("[fail]")) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "mock model failure" } }));
        return;
      }
      if (question.includes("[gone]") && model === GONE_MODEL) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: `No endpoints found for ${model}.` } }));
        return;
      }
      if (question.includes("[tool]") && !toolResult && tools.includes("get_room_history")) {
        answer(response, "", [{ id: "call_mock_history", type: "function", function: { name: "get_room_history", arguments: "{\"limit\":12}" } }]);
        return;
      }
      let reply = REPLY;
      if (question.includes("[markdown]")) reply = MARKDOWN_REPLY;
      else if (question.includes("[quiz]")) reply = "COURSE QUIZ\nQuick check: what does the course text say about pleasure?";
      else if (question.includes("[gone]")) reply = "COURSE\nFallback model reply: the course text explains this topic.";
      else if (question.includes("[followup]")) {
        const earlier = /Participant asked: (.*)/.exec(roomContext)?.[1];
        reply = `COURSE\nFollow-up reply: ${earlier ? `you asked earlier "${earlier}"` : "no earlier question in the room"}.`;
      } else if (question.includes("[tool]") && toolResult) {
        let history = [];
        try {
          history = JSON.parse(String(toolResult.content || "[]"));
        } catch {
          history = [];
        }
        reply = `COURSE\nTool reply: the room history has ${Array.isArray(history) ? history.length : 0} exchange(s), first "${history[0]?.question ?? ""}".`;
      }
      setTimeout(() => answer(response, reply), question.includes("[slow]") ? SLOW_MS : 0);
    });
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { message: "not found" } }));
});

function answer(response, content, toolCalls) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    id: `chatcmpl-mock-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "mock-tutor",
    choices: [{ index: 0, message: { role: "assistant", content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 64, completion_tokens: 16, total_tokens: 80 }
  }));
}

server.listen(PORT, HOST, () => {
  console.log(`studygroup-tutor-mock: listening on http://${HOST}:${PORT}`);
});
