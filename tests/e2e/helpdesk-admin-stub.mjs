// A tiny stand-in for the Learning Guide BackOffice (Admin) Helpdesk
// integration API, used only by tests/e2e/helpdesk-support.spec.ts.
//   GET  /api/integration/helpdesk/questions?locale=   featured Common Questions
//   POST /api/integration/helpdesk/suggest             a suggestion when the text mentions "password"
//   POST /api/integration/helpdesk/suggestions/:id/outcome
//   GET  /__health, /__suggestions, /__outcomes/:id    test inspection
// Usage: node tests/e2e/helpdesk-admin-stub.mjs <port> <bearer-token>
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.argv[2] || 3913);
const token = process.argv[3] || "";
const suggestions = [];
const outcomes = new Map();

const questions = {
  "en-GB": [
    { id: "0192f000-0000-7000-8000-000000000001", category: "course_content", question: "How do I access my course materials?", answer: "Open My Learning and choose your course.\nMaterials are listed under each lesson: https://www.ilovelearningguide.com/help" },
    { id: "0192f000-0000-7000-8000-000000000002", category: "payments_subscriptions", question: "How do I change my subscription?", answer: "Go to My Subscription and choose Change plan." },
    { id: "0192f000-0000-7000-8000-000000000003", category: "payments_subscriptions", question: "Why did my payment fail?", answer: "Check that your card details are correct and that your bank allows online payments." },
    { id: "0192f000-0000-7000-8000-000000000004", category: "technical_support", question: "How do I reset my password?", answer: "Use Forgot password? on the sign-in page." },
    { id: "0192f000-0000-7000-8000-000000000005", category: "payments_subscriptions", question: "Where can I find my invoice?", answer: "Invoices are listed in My Subscription." }
  ],
  "zh-CN": [
    { id: "0192f000-0000-7000-8000-000000000011", category: "course_content", question: "如何访问我的课程资料？", answer: "打开“我的学习”并选择课程。\n资料列在每节课下面。" },
    { id: "0192f000-0000-7000-8000-000000000012", category: "payments_subscriptions", question: "如何更改我的订阅？", answer: "前往“我的订阅”并选择更改方案。" },
    { id: "0192f000-0000-7000-8000-000000000013", category: "payments_subscriptions", question: "为什么我的付款失败了？", answer: "请检查银行卡信息是否正确，以及银行是否允许在线支付。" },
    { id: "0192f000-0000-7000-8000-000000000014", category: "technical_support", question: "如何重置密码？", answer: "在登录页点击“忘记密码？”。" },
    { id: "0192f000-0000-7000-8000-000000000015", category: "payments_subscriptions", question: "在哪里可以找到发票？", answer: "发票列在“我的订阅”中。" }
  ]
};

const answers = {
  "en-GB": "1. Check your spam folder\nThe password reset email might be in your spam or junk folder. Please check and search for an email from \"Learning Guide\".\n\n2. Make sure you're using the correct email address\nPlease confirm you are using the same email address you used to sign up for your Learning Guide account.\n\n3. Resend the password reset email\nGo to the login page and click \"Forgot password?\". If you still do not receive the email after a few minutes, please try again.\n\nIf the above steps do not resolve the issue, you can still submit your enquiry to our support team and we'll be happy to help you further.",
  "zh-CN": "1. 检查垃圾邮件文件夹\n密码重置邮件可能在垃圾邮件文件夹中，请搜索来自 “Learning Guide” 的邮件。\n\n2. 确认使用了正确的邮箱\n请确认你使用的是注册 Learning Guide 账号时的邮箱。\n\n3. 重新发送密码重置邮件\n前往登录页并点击“忘记密码？”。如果几分钟后仍未收到邮件，请再试一次。\n\n如果以上步骤没有解决问题，你仍然可以把问题提交给客服团队，我们很乐意进一步帮助你。"
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

async function json(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  try { return JSON.parse(text || "{}"); } catch { return {}; }
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/__health") return send(response, 200, { ok: true });
  if (url.pathname === "/__suggestions") return send(response, 200, { suggestions });
  const outcomeLookup = /^\/__outcomes\/([^/]+)$/.exec(url.pathname);
  if (outcomeLookup) return send(response, 200, { outcome: outcomes.get(outcomeLookup[1]) ?? null });
  if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { code: "invalid_token" });
  if (request.method === "GET" && url.pathname === "/api/integration/helpdesk/questions") {
    const locale = url.searchParams.get("locale") === "zh-CN" ? "zh-CN" : "en-GB";
    return send(response, 200, { questions: questions[locale], etag: `"stub-${locale}"` }, { ETag: `"stub-${locale}"` });
  }
  if (request.method === "POST" && url.pathname === "/api/integration/helpdesk/suggest") {
    const body = await json(request);
    const text = `${body.subject || ""} ${body.message || ""}`.toLowerCase();
    const matched = text.includes("password") || text.includes("密码");
    const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    const suggestion = matched ? { id: randomUUID(), qaId: questions[locale][3].id, question: questions[locale][3].question, answer: answers[locale] } : null;
    suggestions.push({ request: body, suggestion });
    return send(response, 200, { suggestion });
  }
  const outcome = /^\/api\/integration\/helpdesk\/suggestions\/([^/]+)\/outcome$/.exec(url.pathname);
  if (request.method === "POST" && outcome) {
    const body = await json(request);
    if (!outcomes.has(outcome[1])) outcomes.set(outcome[1], body.outcome);
    response.writeHead(204); return response.end();
  }
  return send(response, 404, { code: "not_found" });
}).listen(port, "127.0.0.1", () => console.log(`helpdesk admin stub on ${port}`));
