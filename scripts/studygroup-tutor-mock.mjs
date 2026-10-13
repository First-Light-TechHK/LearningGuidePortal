// Local OpenAI-compatible tutor mock for the Study Group two-browser E2E test.
// Serves the minimal surface modules/group-study/tutorAnswer.ts parses:
//   - POST /v1/chat/completions -> { choices: [{ message: { content } }] }
// The reply follows the tutor reply contract: the first line is the mode tag
// (stripped before publish), the rest deliberately mentions "the course text"
// so assertions can pin the visible message text.
import { createServer } from "node:http";

const PORT = Number(process.env.STUDYGROUP_TUTOR_MOCK_PORT || 8788);
const HOST = "127.0.0.1";
const REPLY = "COURSE\nMock tutor reply: the course text explains this topic.";

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || HOST}`);
  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      let question = "";
      try {
        const parsed = JSON.parse(body);
        const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
        question = messages.at(-1)?.content || "";
      } catch {
        question = "";
      }
      console.log(`studygroup-tutor-mock: POST /v1/chat/completions bytes=${body.length} question=${JSON.stringify(question.slice(0, 160))}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: `chatcmpl-mock-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "mock-tutor",
        choices: [{ index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" }],
        usage: { prompt_tokens: 64, completion_tokens: 16, total_tokens: 80 }
      }));
    });
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { message: "not found" } }));
});

server.listen(PORT, HOST, () => {
  console.log(`studygroup-tutor-mock: listening on http://${HOST}:${PORT}`);
});
