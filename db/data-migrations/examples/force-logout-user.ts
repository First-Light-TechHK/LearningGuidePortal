/**
 * COPY ME. Teaching material only. Scaffold a real file, then paste.
 *   npm run data:migration:new -- expire_qa_teacher_sessions
 *
 * There is no delete() on the ORM table. Expire sessions so the next request
 * rejects them. Never copy session token hashes from your laptop.
 */
import type { ProductSession, ProductUser } from "../../../services/productStore";
import type { MigrationOrm } from "../../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "../types";

export const id = "099_example_force_logout_user";
export const description = "Expire live sessions for the QA teacher so they must sign in again.";
export const touches = ["sessions"] as const;

const EMAIL = "qa.teacher@example.test";

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const users = orm.table<ProductUser>("users");
  const sessions = orm.table<ProductSession>("sessions");
  const user = users.find((item) => item.email === EMAIL)[0];
  if (!user) return [{ action: "skip", kind: "user", id: EMAIL, reason: "missing" }];
  const live = sessions.find((item) => item.userId === user.id && item.expiresAt > ctx.now);
  if (!live.length) return [{ action: "skip", kind: "session", id: user.id, reason: "none-live" }];
  for (const session of live) sessions.update(session.id, { expiresAt: ctx.now });
  return live.map((session) => ({ action: "update" as const, kind: "session", id: session.id }));
}
