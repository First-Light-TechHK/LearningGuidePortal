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
import { createAdminHelpdeskClient } from "./adminClient";
import { createAssistantService, type AssistantService } from "./assistant";
import { projectOrder } from "./orderDirectory";
import { createHelpdeskService, type HelpdeskService } from "./service";
import { projectStudent } from "./studentDirectory";

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
  return createAssistantService({ repository: helpdeskRepository(), admin: createAdminHelpdeskClient({ traceparent: request?.headers.get("traceparent") }) });
}
