import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContactRequest } from "@/contracts/contact";
import { ContactError } from "@/contracts/contact";
import { query } from "@/services/persistence/db";
import { persistenceEnabled } from "@/services/persistence/config";
import { isProductionEnvironment } from "@/services/runtimeConfig";
import { systemRoot } from "@/services/fileStore";

export async function insertContactRequest(record: ContactRequest): Promise<{ id: string; duplicate: boolean }> {
  let existing: { id: string; payloadHash: string };
  if (persistenceEnabled()) {
    const result = await query<{ id: string }>(`INSERT INTO contact_requests
      (id, client_event_id, payload_hash, user_id, first_name, last_name, email, phone, subject, message, consent, locale, status, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (client_event_id) DO NOTHING RETURNING id`,
      [record.id, record.clientEventId, record.payloadHash, record.userId, record.firstName, record.lastName, record.email, record.phone, record.subject, record.message, record.consent, record.locale, record.status, record.createdAt]);
    if (result.rows[0]) return { id: result.rows[0].id, duplicate: false };
    const rows = await query<{ id: string; payloadHash: string }>('SELECT id, payload_hash AS "payloadHash" FROM contact_requests WHERE client_event_id=$1', [record.clientEventId]);
    existing = rows.rows[0];
  } else {
    if (isProductionEnvironment() || !["local", "fs", "filesystem"].includes((process.env.STORAGE_BACKEND || "").toLowerCase())) throw new ContactError("CONTACT_UNAVAILABLE", 503);
    const directory = path.join(systemRoot(), "contact_requests");
    await mkdir(directory, { recursive: true });
    const filename = path.join(directory, `${record.clientEventId}.json`), temporary = path.join(directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
      try { await link(temporary, filename); return { id: record.id, duplicate: false }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      existing = JSON.parse(await readFile(filename, "utf8")) as ContactRequest;
    } finally { await unlink(temporary).catch(() => undefined); }
  }
  if (!existing || existing.payloadHash !== record.payloadHash) throw new ContactError("CONTACT_CONFLICT", 409);
  return { id: existing.id, duplicate: true };
}
