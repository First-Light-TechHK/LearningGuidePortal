/**
 * COPY ME. Teaching material only. Scaffold a real file, then paste.
 *   npm run data:migration:new -- verify_qa_teacher_email
 *
 * Marks one known email as verified so they can sign in. Do not invent verification
 * tokens — those are one-time secrets and must not live in git.
 */
import type { ProductUser } from "../../../services/productStore";
import type { MigrationOrm } from "../../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "../types";

export const id = "098_example_verify_user_email";
export const description = "Mark the QA teacher email verified if the user is still pending.";
export const touches = ["users"] as const;

const EMAIL = "qa.teacher@example.test";

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const users = orm.table<ProductUser>("users");
  const user = users.find((item) => item.email === EMAIL)[0];
  if (!user) return [{ action: "skip", kind: "user", id: EMAIL, reason: "missing" }];
  if (user.emailVerifiedAt && user.status === "active") {
    return [{ action: "skip", kind: "user", id: user.id, reason: "current" }];
  }
  users.update(user.id, { emailVerifiedAt: user.emailVerifiedAt || ctx.now, status: "active" });
  return [{ action: "update", kind: "user", id: user.id }];
}
