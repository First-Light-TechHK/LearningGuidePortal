/**
 * COPY ME. Teaching material only. Scaffold a real file, then paste.
 *   npm run data:migration:new -- promote_qa_teacher
 *
 * The PR must say why this email is promoted. Do not copy your laptop user list.
 */
import type { ProductUser } from "../../../services/productStore";
import type { MigrationOrm } from "../../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "../types";

export const id = "095_example_promote_user_role";
export const description = "Promote a known DEV email to teacher so they can author courses.";
export const touches = ["users"] as const;

const EMAIL = "qa.teacher@example.test";
const ROLE = "teacher" as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  void ctx;
  const users = orm.table<ProductUser>("users");
  const user = users.find((item) => item.email === EMAIL)[0];
  if (!user) return [{ action: "skip", kind: "user", id: EMAIL, reason: "missing" }];
  if (user.role === ROLE) return [{ action: "skip", kind: "user", id: user.id, reason: "current" }];
  users.update(user.id, { role: ROLE });
  return [{ action: "update", kind: "user", id: user.id }];
}
