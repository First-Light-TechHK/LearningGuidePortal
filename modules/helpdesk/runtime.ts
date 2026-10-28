// Production wiring of the Helpdesk service: storage by environment, the
// existing Portal file/S3 store for attachment bytes, the existing
// Notification Center write path for in-app notifications, the existing
// SMTP path (services/emailService.ts) for learner emails, and a read-only
// projection of existing account / study / subscription data for the
// BackOffice right panel.
import path from "node:path";
import type { HelpdeskLocale } from "@/contracts/helpdesk";
import { helpdeskRepository } from "@/repositories/helpdeskRepository";
import { sendHelpdeskUpdateEmail } from "@/services/emailService";
import { readBinary, systemRoot, writeBinary } from "@/services/fileStore";
import { ensureProductData, recordUserNotification } from "@/services/productStore";
import { publicAppOrigin } from "@/services/runtimeConfig";
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
      get: (key) => readBinary(path.join(systemRoot(), key))
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
    studentDirectory: async (userId) => projectStudent(await ensureProductData(), userId, new Date())
  });
}
