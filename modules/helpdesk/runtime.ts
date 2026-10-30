// Production wiring of the Helpdesk service: storage by environment, the
// existing Portal file/S3 store for attachment bytes, the existing
// Notification Center write path for in-app notifications, the existing
// SMTP path (services/emailService.ts) for learner emails, and a read-only
// projection of existing account / study / subscription data for the
// BackOffice right panel, and (v4 Part A) of the learner's own orders.
import path from "node:path";
import type { HelpdeskLocale, OrderProjection } from "@/contracts/helpdesk";
import { helpdeskRepository } from "@/repositories/helpdeskRepository";
import { sendHelpdeskUpdateEmail } from "@/services/emailService";
import { readBinary, removeDir, systemRoot, writeBinary } from "@/services/fileStore";
import { ensureProductData, recordUserNotification } from "@/services/productStore";
import { publicAppOrigin } from "@/services/runtimeConfig";
import { studyGroupService } from "@/modules/group-study/runtime";
import { createAdminHelpdeskClient } from "./adminClient";
import { outgoingTraceparent, parseTraceparent } from "@/lib/traceparent";
import { createAssistantService, type AssistantService } from "./assistant";
import { sharedFaqReleaseCache } from "./faqReleaseCache";
import { projectOrder } from "./orderDirectory";
import { createHelpdeskService, type HelpdeskService } from "./service";
import { projectStudent } from "./studentDirectory";
import { createInsightsService, type InsightsService, type LearnerAccount } from "./insights";
import { startJobLoop, type LoopTimers } from "./jobScheduler";
import { createRetentionJob, type RetentionJob } from "./retention";
import { persistenceEnabled } from "@/services/persistence/config";

/** The learner's ticket page on the public Portal origin (NEXT_PUBLIC_APP_URL), or null when none is configured. */
export function helpdeskTicketLink(ticketId: string, locale: HelpdeskLocale): string | null {
  try {
    return `${publicAppOrigin()}/${locale}/account/my-learning/support/${ticketId}`;
  } catch {
    return null;
  }
}

/**
 * Built per request: the storage choice follows the current environment
 * (PostgreSQL + S3 when persistence is configured, DEV-only local files when
 * STORAGE_BACKEND=local, otherwise 503 helpdesk_unavailable).
 */
export function helpdeskService(): HelpdeskService {
  return createHelpdeskService({
    repository: helpdeskRepository(),
    // Same abstraction as avatars and Portal media (services/fileStore ->
    // services/persistence/vfs): local files in DEV, S3 + app_files elsewhere.
    blobs: {
      put: (key, bytes) => writeBinary(path.join(systemRoot(), key), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
      get: (key) => readBinary(path.join(systemRoot(), key)),
      // Only for bytes whose ticket change did not commit (removeDir also removes a single file / app_files row).
      remove: (key) => removeDir(path.join(systemRoot(), key))
    },
    // Notification Center rows have no link field; the body carries the
    // ticket number and subject (docs/phase1/helpdesk-tickets.md, TODO).
    notify: async (notification) => {
      await recordUserNotification(notification.userId, notification.title, notification.body);
    },
    // Sent in the background so a slow SMTP server never delays the agent;
    // a failure is logged without the address and never fails the action.
    email: async (mail) => {
      void sendHelpdeskUpdateEmail({ to: mail.to, subject: mail.subject, text: mail.text }).catch((error: unknown) => {
        console.info(JSON.stringify({ type: "helpdesk", event: "email_failed", ticketId: mail.ticketId, kind: mail.kind, error: error instanceof Error ? error.name : "unknown" }));
      });
    },
    ticketLink: helpdeskTicketLink,
    // Read-only: the same product aggregate that getUserById reads; nothing is written.
    studentDirectory: async (userId) => projectStudent(await ensureProductData(), userId, new Date()),
    // v4 Part A: read-only, the learner's own order only; the AI path never calls it.
    orders: learnerOrder
  });
}

/** v4 Part A: the learner's own order as the read-only projection, or null (not theirs, or no such order). */
export async function learnerOrder(userId: string, orderId: string): Promise<OrderProjection | null> {
  return projectOrder(await ensureProductData(), userId, orderId);
}

/**
 * The learner AI Support Assistant (v2 §4b): same storage as the tickets, Admin over the integration API.
 * The request's W3C traceparent, when valid, is continued on the calls to Admin.
 */
export function helpdeskAssistant(request?: Request): AssistantService {
  // v5 Part G1: one trace per learner request, logged with the turn; a valid incoming traceparent is continued.
  const incoming = request?.headers.get("traceparent");
  const traceparent = parseTraceparent(incoming) ? incoming as string : outgoingTraceparent(null);
  const admin = createAdminHelpdeskClient({ traceparent });
  return createAssistantService({
    repository: helpdeskRepository(),
    admin: { suggest: admin.suggest, suggestReply: admin.suggestReply, reportOutcome: admin.reportOutcome, faqs: (locale) => admin.faqs(locale), faq: (id, locale) => admin.faq(id, locale) },
    // v5: the cached published release (60 s revalidation, the last good one kept while Admin is down).
    release: { current: (locale, options) => sharedFaqReleaseCache.current(admin, locale, options) },
    // v5 Part A: read-only, the learner's own records; only enum signals come out, and they never reach Admin or the model.
    learnerRecords: async (learnerId) => {
      const data = await ensureProductData();
      return { user: data.users.find((user) => user.id === learnerId) ?? null, orders: data.orders.filter((order) => order.userId === learnerId), subscriptions: data.subscriptions.filter((item) => item.userId === learnerId) };
    },
    // v7: read-only, the learner's own records and Study Group schedule; only the coarse learner state goes to Admin.
    learnerStateSources: async (learnerId) => {
      const [data, studyGroups] = await Promise.all([ensureProductData(), studyGroupService().learnerSchedule(learnerId)]);
      return {
        user: data.users.find((user) => user.id === learnerId) ?? null,
        subscriptions: data.subscriptions.filter((item) => item.userId === learnerId),
        entitlements: data.entitlements.filter((item) => item.userId === learnerId),
        courses: data.courses,
        studyRecords: data.studyRecords.filter((item) => item.userId === learnerId),
        orders: data.orders.filter((order) => order.userId === learnerId),
        studyGroups
      };
    },
    ownsOrder: async (learnerId, orderId) => (await learnerOrder(learnerId, orderId)) !== null,
    traceId: parseTraceparent(traceparent)?.traceId ?? null
  });
}

/**
 * v5 Part G: the learners' account names and emails (read only, from the same product aggregate), so the scrubber can
 * remove them from their own words. They are never sent anywhere.
 */
export async function learnerAccounts(learnerIds: string[]): Promise<Map<string, LearnerAccount>> {
  const wanted = new Set(learnerIds);
  const data = await ensureProductData();
  return new Map(data.users.filter((user) => wanted.has(user.id)).map((user) => [user.id, { name: user.nickname || "", email: user.email || null }]));
}

/** v5 Part G2: the flywheel feed (GET /api/integration/helpdesk/insights). */
export function helpdeskInsights(): InsightsService {
  return createInsightsService({ repository: helpdeskRepository(), accounts: learnerAccounts });
}

/** v5 Part G1: the 180-day raw-text retention job (daily in-process loop, and the staff "run now"). */
export function helpdeskRetentionJob(): RetentionJob {
  return createRetentionJob({ repository: helpdeskRepository(), accounts: learnerAccounts });
}

/** How often each instance looks whether today's run is done: 2-3 minutes after start, then every 30 minutes. */
export const HELPDESK_JOB_LOOP = { firstDelayMs: 120_000, jitterMs: 60_000, intervalMs: 30 * 60_000 } as const;

/**
 * Starts the in-process daily jobs once per process (instrumentation.ts calls it when the Node server starts; it returns
 * at once). Only where Helpdesk is stored in PostgreSQL: the DEV-only local store has no other instance to agree with,
 * and staff can still run the job now there.
 */
export function startHelpdeskBackgroundJobs(deps: { log?: (line: Record<string, unknown>) => void; timers?: LoopTimers; random?: () => number } = {}): { stop(): void } | null {
  const log = deps.log ?? ((line: Record<string, unknown>) => console.info(JSON.stringify(line)));
  const flag = globalThis as typeof globalThis & { __lgHelpdeskJobsStarted?: boolean };
  if (flag.__lgHelpdeskJobsStarted) return null;
  flag.__lgHelpdeskJobsStarted = true;
  if (!persistenceEnabled()) {
    log({ type: "helpdesk", event: "jobs_not_started", reason: "no_database" });
    return null;
  }
  const firstDelayMs = HELPDESK_JOB_LOOP.firstDelayMs + Math.floor((deps.random ?? Math.random)() * HELPDESK_JOB_LOOP.jitterMs);
  log({ type: "helpdesk", event: "jobs_started", jobs: ["assist_retention"], firstDelayMs, intervalMs: HELPDESK_JOB_LOOP.intervalMs });
  return startJobLoop({
    name: "assist_retention",
    firstDelayMs,
    intervalMs: HELPDESK_JOB_LOOP.intervalMs,
    tick: () => helpdeskRetentionJob().runScheduled(),
    timers: deps.timers,
    log
  });
}
