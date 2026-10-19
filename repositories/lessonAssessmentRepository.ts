import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssessmentKind, SavedAssessment } from "@/contracts/lesson-assessment";
import { AssessmentError } from "@/contracts/lesson-assessment";
import { systemRoot } from "@/services/fileStore";
import { persistenceEnabled } from "@/services/persistence/config";
import { ensureSchema, getPool, query } from "@/services/persistence/db";
import { isManagedEnvironment } from "@/services/runtimeConfig";

type Stored = { record: SavedAssessment; lastEventId: string; payloadHash: string };
const identity = (userId: string, courseId: string) => createHash("sha256").update(JSON.stringify([userId, courseId])).digest("hex");
function localPath(userId: string, courseId: string) {
  if (isManagedEnvironment() || !["local", "fs", "filesystem"].includes((process.env.STORAGE_BACKEND || "").toLowerCase())) throw new AssessmentError("ASSESSMENT_UNAVAILABLE", 503);
  return path.join(systemRoot(), "lesson_assessments", identity(userId, courseId) + ".json");
}
async function localRead(file: string): Promise<Stored[]> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export async function listLessonAssessments(userId: string, courseId: string): Promise<SavedAssessment[]> {
  if (persistenceEnabled()) return (await query<{ record: SavedAssessment }>("SELECT record FROM lesson_assessments WHERE user_id=$1 AND course_id=$2", [userId, courseId])).rows.map(row => row.record);
  return (await localRead(localPath(userId, courseId))).map(row => row.record);
}
export async function saveLessonAssessment(userId: string, courseId: string, lessonId: string, kind: AssessmentKind, expectedVersion: number, clientEventId: string, payloadHash: string, record: SavedAssessment): Promise<SavedAssessment> {
  function validate(existing?: Stored) {
    if (existing?.lastEventId === clientEventId) {
      if (existing.payloadHash !== payloadHash) throw new AssessmentError("ASSESSMENT_CONFLICT", 409);
      return existing.record;
    }
    if ((existing?.record.version || 0) !== expectedVersion) throw new AssessmentError("ASSESSMENT_CONFLICT", 409);
    return null;
  }
  if (persistenceEnabled()) {
    await ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify([userId, courseId, lessonId, kind])]);
      const rows = await client.query<Stored>('SELECT record, last_event_id AS "lastEventId", payload_hash AS "payloadHash" FROM lesson_assessments WHERE user_id=$1 AND course_id=$2 AND lesson_id=$3 AND kind=$4', [userId, courseId, lessonId, kind]);
      const duplicate = validate(rows.rows[0]);
      if (!duplicate) await client.query(`INSERT INTO lesson_assessments (user_id,course_id,lesson_id,kind,version,last_event_id,payload_hash,record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
        ON CONFLICT (user_id,course_id,lesson_id,kind) DO UPDATE SET version=EXCLUDED.version,last_event_id=EXCLUDED.last_event_id,payload_hash=EXCLUDED.payload_hash,record=EXCLUDED.record`, [userId, courseId, lessonId, kind, record.version, clientEventId, payloadHash, JSON.stringify(record)]);
      await client.query("COMMIT"); return duplicate || record;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  const file = localPath(userId, courseId), lock = file + ".lock";
  await mkdir(path.dirname(file), { recursive: true });
  const started = Date.now(); let handle;
  while (!handle) {
    try { handle = await open(lock, "wx"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() - started > 5000) throw error; await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  try {
    const all = await localRead(file), index = all.findIndex(row => row.record.lessonId === lessonId && row.record.kind === kind);
    const duplicate = validate(all[index]); if (duplicate) return duplicate;
    const stored = { record, lastEventId: clientEventId, payloadHash };
    if (index < 0) all.push(stored); else all[index] = stored;
    const temporary = file + "." + randomUUID() + ".tmp";
    try { await writeFile(temporary, JSON.stringify(all), { mode: 0o600 }); await rename(temporary, file); }
    finally { await unlink(temporary).catch(() => undefined); }
    return record;
  } finally { await handle.close(); await unlink(lock); }
}
