// Browser harness for the learner Helpdesk components (components/helpdesk/**,
// the My enquiries page and AccountNav): one esbuild bundle with next/* and the
// server modules stubbed, run in Playwright Chromium inside `npm run test:unit`.
// Every /api/ request is recorded (method, path, Idempotency-Key, JSON or
// multipart body) and answered by the test's handler, so a test can assert
// exactly what the page sent and drive any server answer (409, 429, a lost
// response, a slow suggestion).
import { build } from "esbuild";
import type { Browser, Page, Request as PlaywrightRequest } from "playwright";
import type { CommonQuestion, LearnerAllowedAction, TicketDetail, TicketStatus, TicketSummary } from "../../../contracts/helpdesk";
import { decide, type Command } from "../../../modules/helpdesk/domain";
import { readMultipart } from "../../../modules/helpdesk/http";
import { helpdeskUiConfig } from "../../../modules/helpdesk/learnerUiConfig";

export type Locale = "en-GB" | "zh-CN";
export const LOCALES: readonly Locale[] = ["en-GB", "zh-CN"];
export const ORIGIN = "http://helpdesk.test";

const ENTRY = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ContactSupport} from './components/helpdesk/ContactSupport';
import {EnquiryDetail} from './components/helpdesk/EnquiryDetail';
import {AccountNav} from './components/portal/AccountNav';
import EnquiriesPage from './app/[locale]/account/my-learning/support/enquiries/page';
import {getMessages} from './lib/i18n/messages';
const root=createRoot(document.getElementById('root'));
let mounts=0;
window.__nav=[];
window.mountContact=p=>root.render(<ContactSupport key={++mounts} locale={p.locale} copy={getMessages(p.locale).helpdesk} config={p.config} account={p.account} questions={p.questions}/>);
window.mountDetail=p=>root.render(<EnquiryDetail key={++mounts} locale={p.locale} copy={getMessages(p.locale).helpdesk} config={p.config} initial={p.ticket}/>);
window.mountNav=p=>root.render(<AccountNav key={++mounts} locale={p.locale} copy={getMessages(p.locale).account}/>);
window.mountList=async p=>{window.__list={...p,identities:[]};try{const page=await EnquiriesPage({params:Promise.resolve({locale:p.locale})});root.render(<React.Fragment key={++mounts}>{page}</React.Fragment>);return 'rendered'}catch(error){return String(error&&error.message||error)}};
`;

const STUBS: Record<string, string> = {
  "next/link": "import React from 'react';export default function Link({prefetch,href,...props}){return <a href={href} {...props}/>}",
  // A stable router object: ContactSupport lists it in an effect's dependencies.
  "next/navigation": "const router={push:url=>window.__nav.push(['push',url]),back:()=>window.__nav.push(['back']),replace:url=>window.__nav.push(['replace',url]),refresh:()=>{}};export function useRouter(){return router}export function usePathname(){return location.pathname}export function redirect(url){throw new Error('redirect:'+url)}export function notFound(){throw new Error('notFound')}",
  productAuth: "export async function currentProductUser(){return window.__list.user}",
  runtime: "export function helpdeskService(){return {async listLearnerTickets(identity){window.__list.identities.push(identity);if(window.__list.fail)throw new Error('helpdesk down');return {tickets:window.__list.tickets}}}}",
  PortalHeader: "export function PortalHeader(){return null}",
  PortalFooter: "export function PortalFooter(){return null}"
};

let bundled: Promise<{ js: string; css: string }> | null = null;

/** The page bundle (built once per test file). */
export function helpdeskBundle() {
  bundled ??= build({
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "helpdesk.js", platform: "browser", jsx: "automatic", loader: { ".css": "css" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "helpdesk-stubs",
      setup(b) {
        b.onResolve({ filter: /^next\/(link|navigation)$|services\/productAuth$|modules\/helpdesk\/runtime$|components\/portal\/Portal(Header|Footer)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ loader: "tsx", resolveDir: process.cwd(), contents: STUBS[args.path] ?? STUBS[args.path.split("/").pop() as string] }));
      }
    }]
  }).then((result) => ({
    js: result.outputFiles.find((file) => file.path.endsWith(".js"))!.text,
    css: result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? ""
  }));
  return bundled;
}

export type SentFile = { name: string; size: number; type: string };
export type ApiCall = {
  method: string;
  path: string;
  key: string | null;
  json: Record<string, unknown> | null;
  fields: Record<string, string>;
  files: SentFile[];
};
export type Reply = { status?: number; json?: unknown } | "abort";
export type Handler = (call: ApiCall) => Reply | Promise<Reply>;

async function toCall(request: PlaywrightRequest): Promise<ApiCall> {
  const url = new URL(request.url());
  const headers = request.headers();
  const call: ApiCall = { method: request.method(), path: url.pathname, key: headers["idempotency-key"] ?? null, json: null, fields: {}, files: [] };
  const body = request.postDataBuffer();
  if (!body) return call;
  const type = headers["content-type"] ?? "";
  if (type.startsWith("multipart/form-data")) {
    // Read with the server's own parser, so fields are exactly what the route handler would see.
    const { fields, files } = await readMultipart(new Request(url, { method: "POST", headers: { "content-type": type }, body: new Uint8Array(body) }));
    for (const [name, value] of Object.entries(fields)) call.fields[name] = String(value);
    call.files = files.map((file) => ({ name: file.fileName, size: file.bytes.byteLength, type: file.declaredType }));
  } else if (type.startsWith("application/json")) call.json = JSON.parse(body.toString("utf8"));
  return call;
}

export type Harness = { page: Page; calls: ApiCall[]; setHandler(handler: Handler): void; nav(): Promise<string[][]> };

/** A fresh page at a support URL with the bundle loaded and every /api/ call routed to the handler. */
export async function openHarness(browser: Browser, locale: Locale, handler: Handler = () => ({ status: 500 }), path = `/${locale}/account/my-learning/support`): Promise<Harness> {
  const { js, css } = await helpdeskBundle();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale });
  const calls: ApiCall[] = [];
  let current = handler;
  await page.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    if (!new URL(request.url()).pathname.startsWith("/api/")) {
      await route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
      return;
    }
    const call = await toCall(request);
    calls.push(call);
    const reply = await current(call);
    // The page may have aborted the request meanwhile (Cancel, the suggestion timeout).
    try {
      if (reply === "abort") await route.abort();
      else await route.fulfill({ status: reply.status ?? 200, contentType: (reply.status ?? 200) >= 400 ? "application/problem+json" : "application/json", body: reply.json === undefined ? "" : JSON.stringify(reply.json) });
    } catch { /* request already gone */ }
  });
  await page.goto(`${ORIGIN}${path}`);
  if (css) await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  return {
    page, calls,
    setHandler(next) { current = next; },
    nav: () => page.evaluate(() => (window as unknown as { __nav: string[][] }).__nav)
  };
}

export const config = helpdeskUiConfig();

export type ContactProps = { locale: Locale; account?: { name: string; email: string }; questions?: CommonQuestion[] };
export async function mountContact(page: Page, props: ContactProps) {
  await page.evaluate((p) => (window as unknown as { mountContact(p: unknown): void }).mountContact(p), { config, account: { name: "Emily Chen", email: "emily@example.com" }, questions: [], ...props });
}
export async function mountDetail(page: Page, locale: Locale, ticket: TicketDetail) {
  await page.evaluate((p) => (window as unknown as { mountDetail(p: unknown): void }).mountDetail(p), { config, locale, ticket });
}
export async function mountNav(page: Page, locale: Locale) {
  await page.evaluate((p) => (window as unknown as { mountNav(p: unknown): void }).mountNav(p), { locale });
}
export type ListProps = { locale: Locale; user: { id: string; email?: string; nickname?: string } | null; tickets?: TicketSummary[]; fail?: boolean };
export async function mountList(page: Page, props: ListProps): Promise<{ result: string; identities: unknown[] }> {
  const result = await page.evaluate((p) => (window as unknown as { mountList(p: unknown): Promise<string> }).mountList(p), props);
  const identities = await page.evaluate(() => (window as unknown as { __list: { identities: unknown[] } }).__list.identities);
  return { result, identities };
}

/** Wait (bounded) until the recorded calls satisfy the predicate. */
export async function waitForCalls(harness: Harness, predicate: (calls: ApiCall[]) => boolean, timeoutMs = 5_000) {
  const until = Date.now() + timeoutMs;
  while (!predicate(harness.calls)) {
    if (Date.now() > until) throw new Error(`timed out waiting for API calls; saw ${JSON.stringify(harness.calls.map((call) => `${call.method} ${call.path}`))}`);
    await harness.page.waitForTimeout(20);
  }
}

export const isTicketCreate = (call: ApiCall) => call.method === "POST" && call.path === "/api/helpdesk/tickets";
export const isSuggestion = (call: ApiCall) => call.method === "POST" && call.path === "/api/helpdesk/suggestions";
export const isOutcome = (call: ApiCall) => call.method === "POST" && /^\/api\/helpdesk\/suggestions\/[^/]+\/outcome$/.test(call.path);

const LEARNER_COMMANDS: Array<[LearnerAllowedAction, Command]> = [["reply", "learner_reply"], ["cancel", "cancel"], ["confirm", "confirm"], ["reject", "reject"], ["close", "close"], ["rate", "rate"]];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const TICKET_ID = "0d1e2f30-4a5b-4c6d-8e9f-a0b1c2d3e4f5";

/**
 * A learner TicketDetail in the given state, with allowedActions taken from
 * the real domain rules (modules/helpdesk/domain.ts decide), so the fixture
 * shows exactly the controls the server would allow.
 */
export function ticketFixture(status: TicketStatus, overrides: Partial<TicketDetail> & { closedDaysAgo?: number } = {}): TicketDetail {
  const now = Date.now();
  const { closedDaysAgo, ...rest } = overrides;
  const closedAt = status === "CLOSED" || status === "CANCELLED" ? new Date(now - (closedDaysAgo ?? 1) * DAY).toISOString() : null;
  const confirmDueAt = status === "PENDING_CONFIRM" ? new Date(now + 47 * HOUR).toISOString() : null;
  const rating = rest.rating ?? null;
  const state = { status, assigneeId: status === "OPEN" ? null : "agent-1", confirmDueAt, closedAt, rating };
  const at = new Date(now);
  const allowedActions = LEARNER_COMMANDS.filter(([, command]) => decide(state, command, "learner", at).ok).map(([name]) => name);
  const followUpUntil = status === "CLOSED" && closedAt && now <= Date.parse(closedAt) + 7 * DAY ? new Date(Date.parse(closedAt) + 7 * DAY).toISOString() : null;
  const created = new Date(now - 3 * DAY).toISOString();
  return {
    id: TICKET_ID, number: "LG-261025-0007", subject: "Cannot reset my password", category: "technical_support", status,
    createdAt: created, updatedAt: new Date(now - HOUR).toISOString(), lastMessageAt: new Date(now - HOUR).toISOString(), lastMessageBy: status === "OPEN" ? "learner" : "agent",
    confirmDueAt, closedAt, sequence: 4, locale: "en-GB", contactEmail: "emily@example.com", assigneeName: status === "OPEN" ? null : "Alex",
    closeReason: status === "CLOSED" ? "user_confirmed" : status === "CANCELLED" ? "cancelled" : null, rating, followUpUntil,
    messages: [
      { id: "m-1", authorKind: "learner", authorName: "Emily Chen", body: "The reset email never arrives.\nI checked spam.", createdAt: created, attachments: [] },
      ...(status === "OPEN" ? [] : [{ id: "m-2", authorKind: "agent" as const, authorName: "Alex", body: "Please try again now: https://example.com/reset", createdAt: new Date(now - 2 * DAY).toISOString(), attachments: [] }])
    ],
    timeline: [], allowedActions,
    ...rest
  };
}
