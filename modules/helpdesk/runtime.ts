// Production wiring of the Helpdesk service: storage by environment, the
// existing Portal file/S3 store for attachment bytes, and the existing
// Notification Center write path for in-app notifications.
import path from "node:path";
import { helpdeskRepository } from "@/repositories/helpdeskRepository";
import { readBinary, systemRoot, writeBinary } from "@/services/fileStore";
import { recordUserNotification } from "@/services/productStore";
import { createHelpdeskService, type HelpdeskService } from "./service";

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
    }
  });
}
