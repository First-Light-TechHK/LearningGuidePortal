// Help Centre data (tickets-v2-figma-addendum §4d): what /{locale}/help asks
// Admin for in each mode (popular, ?q= search, ?category=), the ?faq= deep
// link loaded by id when it is not in the list, the static fallback when
// Admin is unavailable with nothing cached, the query parsing, and where the
// Contact Support button goes for signed-in and signed-out visitors.
import assert from "node:assert/strict";
import test from "node:test";
import { parseHelpCentreQuery, type FaqFilter, type HelpFaq } from "../../contracts/helpdesk";
import { contactSupportHref, loadHelpCentre, type HelpCentreClient } from "../../modules/helpdesk/helpCentre";

const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;
const faq = (n: number, extra: Partial<HelpFaq> = {}): HelpFaq => ({ id: id(n), category: "payments_subscriptions", popular: n <= 2, question: `Question ${n}?`, answer: `Answer **${n}**.`, updatedAt: "2026-10-28T10:00:00.000Z", ...extra });
const STATIC = [{ question: "How do I enroll in a course?", answer: "Choose a course." }, { question: "What payment methods do you accept?", answer: "Shown in checkout." }];

function fakeClient(answers: { list?: (filter: FaqFilter) => HelpFaq[] | null; one?: (faqId: string) => HelpFaq | null } = {}) {
  const calls: Array<[string, string, unknown]> = [];
  const client: HelpCentreClient = {
    async faqs(locale, filter = {}) { calls.push(["faqs", locale, filter]); return answers.list ? answers.list(filter) : []; },
    async faq(faqId, locale) { calls.push(["faq", locale, faqId]); return answers.one ? answers.one(faqId) : null; }
  };
  return { client, calls };
}

const NONE = { q: "", category: null, faq: null };

test("popular mode asks for popular FAQs, and for the newest ones when none is marked popular", async () => {
  const { client, calls } = fakeClient({ list: (filter) => (filter.popular ? [faq(1), faq(2)] : []) });
  const view = await loadHelpCentre(client, "en-GB", NONE, STATIC);
  assert.deepEqual(calls, [["faqs", "en-GB", { popular: true, limit: 10 }]]);
  assert.equal(view.mode, "popular");
  assert.equal(view.fallback, false);
  assert.deepEqual(view.articles.map((article) => article.id), [id(1), id(2)]);
  assert.deepEqual(view.articles[0], { id: id(1), category: "payments_subscriptions", question: "Question 1?", answer: "Answer **1**." });
  const none = fakeClient({ list: (filter) => (filter.popular ? [] : [faq(3)]) });
  const newest = await loadHelpCentre(none.client, "zh-CN", NONE, STATIC);
  assert.deepEqual(none.calls, [["faqs", "zh-CN", { popular: true, limit: 10 }], ["faqs", "zh-CN", { limit: 10 }]]);
  assert.deepEqual(newest.articles.map((article) => article.id), [id(3)]);
});

test("search and category modes ask Admin with q / category; a search ignores the category", async () => {
  const search = fakeClient({ list: () => [faq(4)] });
  const found = await loadHelpCentre(search.client, "en-GB", { q: "invoice", category: "other", faq: null }, STATIC);
  assert.deepEqual(search.calls, [["faqs", "en-GB", { q: "invoice", limit: 50 }]]);
  assert.equal(found.mode, "search");
  assert.equal(found.q, "invoice");
  const topic = fakeClient({ list: () => [faq(5)] });
  const listed = await loadHelpCentre(topic.client, "zh-CN", { q: "", category: "account_technical", faq: null }, STATIC);
  assert.deepEqual(topic.calls, [["faqs", "zh-CN", { category: "account_technical", limit: 50 }]]);
  assert.equal(listed.mode, "category");
  assert.equal(listed.category, "account_technical");
  const empty = await loadHelpCentre(fakeClient({ list: () => [] }).client, "en-GB", { q: "nothing", category: null, faq: null }, STATIC);
  assert.deepEqual(empty.articles, [], "an empty search is an empty list, not the fallback");
  assert.equal(empty.fallback, false);
});

test("?faq= opens an article in the list, or loads it by id and puts it first; an unknown id opens nothing", async () => {
  const listed = fakeClient({ list: () => [faq(1), faq(2)] });
  const inList = await loadHelpCentre(listed.client, "en-GB", { ...NONE, faq: id(2) }, STATIC);
  assert.equal(inList.openId, id(2));
  assert.equal(listed.calls.length, 1, "no extra request when it is already listed");
  const byId = fakeClient({ list: () => [faq(1)], one: (faqId) => (faqId === id(9) ? faq(9, { category: "other", popular: false }) : null) });
  const loaded = await loadHelpCentre(byId.client, "zh-CN", { ...NONE, faq: id(9) }, STATIC);
  assert.deepEqual(byId.calls[1], ["faq", "zh-CN", id(9)]);
  assert.deepEqual(loaded.articles.map((article) => article.id), [id(9), id(1)]);
  assert.equal(loaded.openId, id(9));
  const unknown = await loadHelpCentre(fakeClient({ list: () => [faq(1)] }).client, "en-GB", { ...NONE, faq: id(8) }, STATIC);
  assert.equal(unknown.openId, null);
  assert.deepEqual(unknown.articles.map((article) => article.id), [id(1)]);
  assert.equal(inList.missingFaq, false);
  assert.equal(loaded.missingFaq, false);
  assert.equal(unknown.missingFaq, true, "an archived or unknown ?faq= says so instead of silently showing the list");
  const plain = await loadHelpCentre(fakeClient({ list: () => [faq(1)] }).client, "en-GB", NONE, STATIC);
  assert.equal(plain.missingFaq, false);
});

test("?faq= never adds an unrelated FAQ to search results or to another topic's list", async () => {
  const other = faq(9, { category: "other", popular: false });
  const search = fakeClient({ list: () => [faq(4)], one: () => other });
  const found = await loadHelpCentre(search.client, "en-GB", { q: "password", category: null, faq: id(9) }, STATIC);
  assert.deepEqual(found.articles.map((article) => article.id), [id(4)], "search results are Admin's matches only");
  assert.equal(found.openId, null);
  assert.equal(found.missingFaq, false);
  assert.deepEqual(search.calls.map((call) => call[0]), ["faqs"], "a search does not load the deep link by id");
  const topic = fakeClient({ list: () => [faq(5, { category: "account_technical" })], one: () => other });
  const listed = await loadHelpCentre(topic.client, "en-GB", { q: "", category: "account_technical", faq: id(9) }, STATIC);
  assert.deepEqual(listed.articles.map((article) => article.id), [id(5)], "an FAQ from another topic is not shown under this one");
  assert.equal(listed.openId, null);
  assert.equal(listed.missingFaq, false);
  const same = fakeClient({ list: () => [faq(5, { category: "other" })], one: () => other });
  const sameTopic = await loadHelpCentre(same.client, "en-GB", { q: "", category: "other", faq: id(9) }, STATIC);
  assert.deepEqual(sameTopic.articles.map((article) => article.id), [id(9), id(5)], "an FAQ of this topic past the list limit is loaded and opened");
  assert.equal(sameTopic.openId, id(9));
  const gone = await loadHelpCentre(fakeClient({ list: () => [faq(5, { category: "other" })], one: () => null }).client, "en-GB", { q: "", category: "other", faq: id(9) }, STATIC);
  assert.equal(gone.missingFaq, true);
});

test("Admin unavailable with nothing cached: the static copy, searchable in the page, never an error", async () => {
  const down = fakeClient({ list: () => null, one: () => { throw new Error("must not be asked"); } });
  const view = await loadHelpCentre(down.client, "en-GB", { ...NONE, faq: id(1) }, STATIC);
  assert.equal(view.fallback, true);
  assert.deepEqual(view.articles, [
    { id: "static-0", category: null, question: STATIC[0].question, answer: STATIC[0].answer },
    { id: "static-1", category: null, question: STATIC[1].question, answer: STATIC[1].answer }
  ]);
  assert.equal(view.openId, null);
  const searched = await loadHelpCentre(fakeClient({ list: () => null }).client, "en-GB", { q: "PAYMENT", category: null, faq: null }, STATIC);
  assert.deepEqual(searched.articles.map((article) => article.question), [STATIC[1].question], "the fallback is filtered by the search words");
  assert.equal(view.missingFaq, false, "with Admin down the deep link cannot be checked");
  const topic = await loadHelpCentre(fakeClient({ list: () => null }).client, "en-GB", { q: "", category: "other", faq: null }, STATIC);
  assert.equal(topic.mode, "popular", "the static copy has no topics, so it is not shown under a topic's name");
  assert.equal(topic.category, null);
  assert.equal(topic.articles.length, STATIC.length);
  const thrown = await loadHelpCentre({ async faqs() { throw new Error("boom"); }, async faq() { return null; } }, "en-GB", NONE, STATIC);
  assert.equal(thrown.fallback, true, "a thrown error is the fallback too");
});

test("query parsing is forgiving (public page) and Contact Support goes through sign-in for visitors", () => {
  assert.deepEqual(parseHelpCentreQuery({ q: "  invoice  ", category: "payments_subscriptions", faq: id(1).toUpperCase() }), { q: "invoice", category: "payments_subscriptions", faq: id(1) });
  assert.deepEqual(parseHelpCentreQuery({ q: ["a", "b"], category: "nope", faq: "x" }), { q: "a", category: null, faq: null });
  assert.deepEqual(parseHelpCentreQuery({ q: "bad\u0000" }), NONE);
  assert.equal([...parseHelpCentreQuery({ q: "字".repeat(200) }).q].length, 120);
  assert.equal(contactSupportHref("en-GB", true), "/en-GB/account/my-learning/support");
  assert.equal(contactSupportHref("zh-CN", false), "/zh-CN/portal/sign-in?returnTo=%2Fzh-CN%2Faccount%2Fmy-learning%2Fsupport");
});

test("the old account help URLs redirect to the public Help Centre", async () => {
  const { default: accountHelp } = await import("../../app/[locale]/account/my-learning/help/page");
  const { default: alias } = await import("../../app/[locale]/my-learning/help/page");
  for (const [page, locale, target] of [[accountHelp, "zh-CN", "/zh-CN/help"], [alias, "en-GB", "/en-GB/help"], [accountHelp, "fr-FR", "/en-GB/help"]] as const) {
    await assert.rejects(page({ params: Promise.resolve({ locale }) }), (error: Error & { digest?: string }) => {
      assert.match(error.digest ?? "", new RegExp(`^NEXT_REDIRECT;[a-z]+;${target.replace(/\//g, "\\/")};`));
      return true;
    });
  }
});
