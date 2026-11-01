// A tiny stand-in for the Learning Guide BackOffice (Admin) Helpdesk
// integration API v2 (tickets-v2-figma-addendum §2), used only by
// tests/e2e/helpdesk-support.spec.ts. The FAQ data mirrors the Figma example
// data (1387:2, 1216:6); it is example data, not real content.
//   GET  /api/integration/helpdesk/faqs?locale=&popular=&category=&q=&limit=   published FAQs, popular first
//   GET  /api/integration/helpdesk/faqs/:id?locale=                         one FAQ or 404
//   POST /api/integration/helpdesk/suggest      chip (faqId) → that FAQ; chat / submit → a match on the words, else null;
//                                               the suggestion id is the runId Portal sent; the traceparent header is recorded.
//                                               Contract v4: alternatives ("You might be asking") only with no answer —
//                                               for an "account" / "账号" question with no match, the account FAQs
//                                               (as Admin's retrieval ranks them), never the chip just asked; [] otherwise
//                                               (as Admin with no popular FAQs marked), so other submits still go straight through
//                                               Contract v6 (Helpdesk v5): with a context (Portal v5 always sends one) the
//                                               turn fields too: smalltalk for a hello / thanks, the choice node for
//                                               "付款有问题" (unsure), the picked blocks for the long "没开通" answer, and
//                                               guard-passed opening / closing lines; no_match otherwise.
//   GET  /api/integration/helpdesk/faq-release/current?locale=   v5: a published release for zh-CN only (an FAQ
//                                               tree: a choice node, a 3-level follow-up chain, a shared node), with
//                                               ETag / If-None-Match; 404 no_release for en-GB, so both paths run
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

/** v5 Part A: the FAQ signals staff tagged (the payment FAQ for a failed payment). */
const SIGNALS = { 5: ["payment_failed"] };

/** The FAQs an "account" question is closest to, in rank order (reset password, access courses, course materials). */
const ACCOUNT_ALTERNATIVES = [1, 7, 2];
const faqId = (n) => `0192f000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const faqs = (locale) => ROWS.map(([n, category, popular, en, enAnswer, zh, zhAnswer, words]) => ({
  id: faqId(n), category, popular, signals: SIGNALS[n] ?? [],
  question: locale === "zh-CN" ? zh : en,
  answer: locale === "zh-CN" ? zhAnswer : enAnswer,
  updatedAt: new Date(Date.UTC(2026, 9, 28, 10, 0, 60 - n)).toISOString(),
  words
}));
const pick = ({ words, ...faq }) => faq;

// ---- v5: the zh-CN release (helpdesk-v5-faq-graph-design.md §1). Example data, not real content.
/** [id suffix, type, entry, popular, signals, question, answer, words] beyond the FAQ rows above. */
const TREE = [
  [101, "choice", true, false, [], "付款遇到问题了？", "你遇到的是哪种情况？", ["付款有问题"]],
  [102, "answer", true, false, ["recent_purchase"], "付款成功但没有开通", "付款成功后，课程通常会在几分钟内自动开通。如果你是用银行卡或第三方支付付款的，银行确认扣款可能需要更长一点的时间，这段时间里页面上可能还显示未开通。\n\n1. 退出登录后重新登录，让账号重新读取你的订阅状态\n2. 打开**我的学习**，查看课程是否已经出现在你的课程列表里\n\n仍然没有开通？在**我的订阅**的付款记录中确认这笔订单的状态：显示“已支付”说明付款已经完成，显示“处理中”说明还在等待银行确认。\n\n如果付款记录显示已支付但仍无法学习，请联系客服并附上订单号，客服团队会帮你核实订单并尽快为你开通课程。", ["没开通"]],
  [103, "answer", false, false, [], "收不到重置邮件怎么办？", "请先检查垃圾邮件文件夹，并确认使用的是注册时的邮箱。", []],
  [104, "answer", false, false, [], "换了邮箱还能找回账号吗？", "可以。联系客服并说明注册时使用的邮箱，客服会帮你核实。", []],
  [105, "answer", true, false, [], "如何联系客服？", "在本页左侧填写表单提交问题，客服团队会通过邮件回复你。", []],
  [106, "answer", false, false, [], "被重复扣款了怎么办？", "请在**我的订阅**中查看付款记录，然后联系客服说明情况。", []]
];
/** [parent, child, kind, position, label override] */
const EDGES = [
  [101, 5, "option", 0, "付款失败"], [101, 102, "option", 1, "扣款了但没开通"], [101, 106, "option", 2, "被重复扣款"],
  [1, 103, "follow_up", 0, null], [103, 104, "follow_up", 0, null], [104, 105, "follow_up", 0, null],
  [102, 105, "follow_up", 0, "还是不行，怎么联系客服？"], [5, 105, "follow_up", 0, null]
];
const RELEASE_VERSION = 1;
/** Admin splits answers into blocks at release time (one per paragraph or list); the stub splits on blank lines. */
const blocksOf = (answer) => answer.split(/\n{2,}/).map((text, index) => ({ id: `b${index + 1}`, text }));
function zhNodes() {
  const rows = faqs("zh-CN").map((faq) => ({ id: faq.id, key: `faq-${faq.id.slice(-3)}`, type: "answer", entry: true, category: faq.category, popular: faq.popular, question: faq.question, answer: faq.answer, blocks: blocksOf(faq.answer), signals: faq.signals, words: faq.words }));
  const tree = TREE.map(([n, type, entry, popular, signals, question, answer, words]) => ({ id: faqId(n), key: `tree-${n}`, type, entry, category: "payments_subscriptions", popular, question, answer, blocks: type === "choice" ? [] : blocksOf(answer), signals, words }));
  return [...rows, ...tree];
}
function zhRelease() {
  const nodes = zhNodes();
  const question = (n) => nodes.find((node) => node.id === faqId(n)).question;
  return {
    version: RELEASE_VERSION, publishedAt: "2026-10-30T09:00:00.000Z", locale: "zh-CN",
    nodes: nodes.map(({ words, ...node }) => node),
    edges: EDGES.map(([parent, child, kind, position, label]) => ({ parentId: faqId(parent), childId: faqId(child), kind, position, label: label ?? question(child) }))
  };
}

/** Contract v6: Admin's turn for a request with a context (the model's lines here are the stub's; Portal guards them again). */
function turnFor(body, found) {
  const zh = body.locale === "zh-CN";
  const releaseVersion = zh ? RELEASE_VERSION : null;
  const text = String(body.message || "").toLowerCase();
  const none = { nodeId: null, blocks: [], opening: null, closing: null, reply: null, explanation: null, covered: null, releaseVersion };
  if (!found && /^(你好|您好|在吗|hi\b|hello)/.test(text)) return { ...none, kind: "smalltalk", intent: "greeting", confidence: "sure", reply: zh ? "你好呀！想了解哪方面的问题？" : "Hi there! What can I help you with today?", guard: { result: "passed", reason: null, fallback: [] } };
  if (!found && /(谢谢|再见|thanks|thank you|bye)/.test(text)) return { ...none, kind: "smalltalk", intent: "farewell", confidence: "sure", reply: zh ? "不客气！有问题随时再来问我。" : "You're welcome! Come back any time.", guard: { result: "passed", reason: null, fallback: [] } };
  if (!found) return { ...none, kind: "no_match", intent: "question", confidence: "unsure", guard: null };
  if (found.type === "choice") return { ...none, kind: "answer", intent: "question", confidence: "unsure", nodeId: found.id, guard: null };
  return {
    ...none, kind: "answer", intent: "question", confidence: "sure", nodeId: found.id, blocks: found.id === faqId(102) ? ["b2", "b3"] : [],
    opening: zh ? "别着急，这个问题可以这样处理：" : "No worries, here's how to sort it:", closing: zh ? "按上面试一下，还不行就告诉我。" : "Give that a try and tell me if it doesn't work.",
    guard: { result: "passed", reason: null, fallback: [] }
  };
}

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
    // zh-CN answers from its release (the FAQ rows and the tree); en-GB from the published FAQs.
    const list = body.locale === "zh-CN" ? zhNodes() : faqs("en-GB");
    let found = null;
    if (body.source === "chip") found = list.find((faq) => faq.id === body.faqId) ?? null;
    else {
      const text = `${body.subject || ""} ${body.message || ""}`.toLowerCase();
      found = list.find((faq) => faq.words.some((word) => text.includes(word))) ?? null;
    }
    // As Admin does: the run id Portal sent is the suggestion id.
    const suggestion = found ? { id: body.runId || randomUUID(), faqId: found.id, question: found.question, answer: found.answer } : null;
    const turn = body.context && typeof body.context === "object" ? turnFor(body, found) : null;
    const asked = `${body.subject || ""} ${body.message || ""}`.toLowerCase();
    const alternatives = !suggestion && /account|账号/.test(asked)
      ? ACCOUNT_ALTERNATIVES.map((n) => list.find((faq) => faq.id === faqId(n))).filter((faq) => faq.id !== body.faqId && !(body.shownFaqIds ?? []).includes(faq.id)).slice(0, 3).map((faq) => ({ faqId: faq.id, question: faq.question }))
      : [];
    suggestions.push({ request: body, suggestion, alternatives, turn, traceparent: request.headers.traceparent ?? null });
    return send(response, 200, turn ? { suggestion, alternatives, ...turn } : { suggestion, alternatives });
  }
  if (request.method === "GET" && url.pathname === "/api/integration/helpdesk/faq-release/current") {
    if (url.searchParams.get("locale") !== "zh-CN") return send(response, 404, { type: "about:blank", title: "No release", status: 404, code: "no_release" }, { "Content-Type": "application/problem+json" });
    const etag = `"v${RELEASE_VERSION}"`;
    const match = (request.headers["if-none-match"] || "").split(",").map((tag) => tag.trim().replace(/^W\//, ""));
    if (match.includes(etag) || match.includes("*")) { response.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" }); return response.end(); }
    return send(response, 200, zhRelease(), { ETag: etag, "Cache-Control": "no-cache" });
  }
  const outcome = /^\/api\/integration\/helpdesk\/suggestions\/([^/]+)\/outcome$/.exec(url.pathname);
  if (request.method === "POST" && outcome) {
    const body = await json(request);
    if (!outcomes.has(outcome[1])) outcomes.set(outcome[1], body.outcome);
    response.writeHead(204); return response.end();
  }
  return send(response, 404, { code: "not_found" });
}).listen(port, "127.0.0.1", () => console.log(`helpdesk admin stub on ${port}`));
