import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { systemRoot } from "@/services/fileStore";
import { persistenceEnabled } from "@/services/persistence/config";
import { query } from "@/services/persistence/db";

const OWNER_KEYS = new Set(["userId", "user_id", "learnerId", "learner_id", "hostUserId", "host_user_id", "authorId", "author_id", "actorUserId"]);

function owns(value: unknown, userId: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(item => owns(item, userId));
  return Object.entries(value).some(([key, item]) => OWNER_KEYS.has(key) && item === userId || owns(item, userId));
}

async function readOptional(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** Unbound Sessions cannot create business data. Also reject historical anomalies. */
export async function hasIndependentEmailBindingHistory(userId: string, courseIds: string[]) {
  if (persistenceEnabled()) {
    const result = await query<{ found: boolean }>(`SELECT (
      EXISTS (SELECT 1 FROM lesson_assessments WHERE user_id=$1)
      OR EXISTS (SELECT 1 FROM study_groups WHERE host_user_id=$1)
      OR EXISTS (SELECT 1 FROM study_group_memberships WHERE user_id=$1)
      OR EXISTS (SELECT 1 FROM study_group_presences WHERE user_id=$1)
      OR EXISTS (SELECT 1 FROM study_group_attendance_intents WHERE user_id=$1)
      OR EXISTS (SELECT 1 FROM study_group_tutor_requests WHERE user_id=$1)
      OR EXISTS (SELECT 1 FROM contact_requests WHERE user_id=$1)
      OR EXISTS (SELECT 1 FROM helpdesk_tickets WHERE user_id=$1)
      OR EXISTS (SELECT 1 FROM helpdesk_assist_log WHERE learner_id=$1)
      OR EXISTS (SELECT 1 FROM helpdesk_chat_sessions WHERE learner_id=$1)
    ) AS found`, [userId]);
    return result.rows[0]?.found === true;
  }
  const root = systemRoot();
  for (const file of [path.join(root, "learning_guide", "study-group", "study-group.json"), path.join(root, "helpdesk", "store.json")]) {
    if (owns(await readOptional(file), userId)) return true;
  }
  for (const courseId of courseIds) {
    const key = createHash("sha256").update(JSON.stringify([userId, courseId])).digest("hex");
    const records = await readOptional(path.join(root, "lesson_assessments", `${key}.json`));
    if (Array.isArray(records) && records.length) return true;
  }
  return false;
}
