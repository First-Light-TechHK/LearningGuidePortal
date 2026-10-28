// A tiny stand-in for the Learning Guide BackOffice (Admin) Helpdesk
// integration API v2 (tickets-v2-figma-addendum §2), used only by
// tests/e2e/helpdesk-support.spec.ts. The FAQ data mirrors the Figma example
// data (1387:2, 1216:6); it is example data, not real content.
//   GET  /api/integration/helpdesk/faqs?locale=&popular=&category=&q=&limit=   published FAQs, popular first
//   GET  /api/integration/helpdesk/faqs/:id?locale=                         one FAQ or 404
//   POST /api/integration/helpdesk/suggest      chip (faqId) → that FAQ; chat / submit → a match on the words, else null
//   POST /api/integration/helpdesk/suggestions/:id/outcome   first outcome wins
//   GET  /__health, /__suggestions, /__outcomes/:id    test inspection
// Usage: node tests/e2e/helpdesk-admin-stub.mjs <port> <bearer-token>
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.argv[2] || 3913);
const token = process.argv[3] || "";
const suggestions = [];
const outcomes = new Map();

const resetSteps = {
  "en-GB": "Follow the steps to regain access to your Learning Guide account.\n\n1. **Check your spam folder**\nThe password reset email might be in your spam or junk folder. Search for an email from \"Learning Guide\".\n2. **Make sure you're using the correct email address**\nUse the same email address you used to sign up for your Learning Guide account.\n3. **Resend the password reset email**\nGo to the [sign-in page](https://www.ilovelearningguide.com/en-GB/portal/sign-in) and click \"Forgot password?\".\n\nIf the above steps do not resolve the issue, you can still submit your enquiry to our support team.",
  "zh-CN": "按照以下步骤重新登录你的 Learning Guide 账号。\n\n1. **检查垃圾邮件文件夹**\n密码重置邮件可能在垃圾邮件文件夹中，请搜索来自 “Learning Guide” 的邮件。\n2. **确认使用了正确的邮箱**\n请使用注册 Learning Guide 账号时的邮箱。\n3. **重新发送密码重置邮件**\n前往[登录页](https://www.ilovelearningguide.com/zh-CN/portal/sign-in)并点击“忘记密码？”。\n\n如果以上步骤没有解决问题，你仍然可以把问题提交给客服团队。"
};

/** [id suffix, category, popular, en question, en answer, zh question, zh answer, words that match it in chat] */
const ROWS = [
  [1, "account_technical", true, "How do I reset my password?", resetSteps["en-GB"], "如何重置密码？", resetSteps["zh-CN"], ["password", "密码"]],
  [2, "courses_learning", true, "How can I access my course materials?", "Find your enrolled courses and open the available lessons and resources.\n\nOpen **My Learning** and choose your course.", "如何访问我的课程资料？", "找到你已报名的课程，打开可用的课节和资料。\n\n打开**我的学习**并选择课程。", []],
  [3, "payments_subscriptions", true, "How do I change my subscription?", "Learn where to review your plan and the available subscription options.\n\nGo to **My Subscription** and choose **Change plan**.", "如何更改我的订阅？", "了解在哪里查看你的方案和可选的订阅。\n\n前往**我的订阅**并选择更改方案。", ["subscription", "订阅"]],
  [4, "payments_subscriptions", true, "Where can I find my invoice?", "See where you can access the billing records for your payments.\n\n- Open **My Subscription**\n- Choose **Records**", "在哪里可以找到发票？", "了解在哪里查看付款的账单记录。\n\n- 打开**我的订阅**\n- 选择**记录**", ["invoice", "发票"]],
  [5, "payments_subscriptions", true, "Why did my payment fail?", "Check common payment issues and the next steps you can try.", "为什么我的付款失败了？", "查看常见的付款问题，以及你可以尝试的下一步。", ["payment fail", "付款失败"]],
  [6, "courses_learning", true, "How do I join a live session?", "Find your scheduled sessions and the information for joining them.", "如何加入直播课？", "找到你已安排的课程以及加入方式。", ["live", "直播"]],
  [7, "courses_learning", false, "How do I access my courses?", "You can find your enrolled courses in My Learning and open their available lessons and resources.", "如何访问我的课程？", "你可以在“我的学习”中找到已报名的课程，并打开可用的课节和资料。", ["course materials", "课程资料"]],
  [8, "other", false, "Can I suggest a new feature?", "Yes. Choose **Other Enquiries** on the Contact Support form and tell us your idea.", "可以提出新功能建议吗？", "可以。在联系客服表单中选择**其他问题**，告诉我们你的想法。", ["feature", "建议"]]
];

const faqId = (n) => `0192f000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const faqs = (locale) => ROWS.map(([n, category, popular, en, enAnswer, zh, zhAnswer, words]) => ({
  id: faqId(n), category, popular,
  question: locale === "zh-CN" ? zh : en,
  answer: locale === "zh-CN" ? zhAnswer : enAnswer,
  updatedAt: new Date(Date.UTC(2026, 9, 28, 10, 0, 60 - n)).toISOString(),
  words
}));
const pick = ({ words, ...faq }) => faq;

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
  const locale = url.searchParams.get("locale") === "zh-CN" ? "zh-CN" : "en-GB";
  if (request.method === "GET" && url.pathname === "/api/integration/helpdesk/faqs") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const category = url.searchParams.get("category");
    let list = faqs(locale);
    if (url.searchParams.get("popular") === "true") list = list.filter((faq) => faq.popular);
    if (category) list = list.filter((faq) => faq.category === category);
    if (q) list = list.filter((faq) => `${faq.question}\n${faq.answer}\n${faq.words.join(" ")}`.toLowerCase().includes(q));
    list.sort((a, b) => Number(b.popular) - Number(a.popular) || b.updatedAt.localeCompare(a.updatedAt));
    const limit = Math.min(100, Number(url.searchParams.get("limit") || 100));
    return send(response, 200, { faqs: list.slice(0, limit).map(pick), etag: `"stub-${locale}"` }, { ETag: `"stub-${locale}"` });
  }
  const one = /^\/api\/integration\/helpdesk\/faqs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && one) {
    const found = faqs(locale).find((faq) => faq.id === one[1]);
    return found ? send(response, 200, pick(found)) : send(response, 404, { code: "not_found" });
  }
  if (request.method === "POST" && url.pathname === "/api/integration/helpdesk/suggest") {
    const body = await json(request);
    const list = faqs(body.locale === "zh-CN" ? "zh-CN" : "en-GB");
    let found = null;
    if (body.source === "chip") found = list.find((faq) => faq.id === body.faqId) ?? null;
    else {
      const text = `${body.subject || ""} ${body.message || ""}`.toLowerCase();
      found = list.find((faq) => faq.words.some((word) => text.includes(word))) ?? null;
    }
    const suggestion = found ? { id: randomUUID(), faqId: found.id, question: found.question, answer: found.answer } : null;
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
