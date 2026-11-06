import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptTutorPost, acceptTutorWithdraw } from "../../modules/group-study/tutorHttp";

test("room tutor mutations reject cross-origin requests before authentication", async () => {
  for (const method of ["POST", "DELETE"] as const) {
    const request = new Request("http://localhost:3011/api/study-groups/sessions/session-1/ai-tutor", {
      method,
      headers: { origin: "https://other.example" },
      body: "{}",
    });
    const response = method === "POST" ? await acceptTutorPost(request, "session-1") : await acceptTutorWithdraw(request, "session-1");
    assert.equal(response.status, 403);
  }
});

test("same-origin room tutor request reaches authentication", async () => {
  const request = new Request("http://localhost:3011/api/study-groups/sessions/session-1/ai-tutor", {
    method: "POST",
    headers: { origin: "http://localhost:3011" },
    body: "{}",
  });
  assert.equal((await acceptTutorPost(request, "session-1")).status, 401);
});
