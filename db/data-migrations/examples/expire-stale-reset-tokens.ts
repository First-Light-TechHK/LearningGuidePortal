/**
 * COPY ME. Teaching material only. Scaffold a real file, then paste.
 *   npm run data:migration:new -- expire_used_reset_tokens
 *
 * Password-reset and email-verify tokens are secrets. Expire leftovers. Do not
 * insert a token so someone can log in — that would put a usable secret in git.
 */
import type { ProductToken } from "../../../services/productStore";
import type { MigrationOrm } from "../../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "../types";

export const id = "100_example_expire_reset_tokens";
export const description = "Mark leftover unused password-reset tokens as used so they cannot be replayed.";
export const touches = ["tokens"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const tokens = orm.table<ProductToken>("passwordResetTokens");
  const leftover = tokens.find((item) => !item.usedAt);
  if (!leftover.length) return [{ action: "skip", kind: "token", id: "passwordResetTokens", reason: "none" }];
  for (const token of leftover) tokens.update(token.id, { usedAt: ctx.now, expiresAt: ctx.now });
  return leftover.map((token) => ({ action: "update" as const, kind: "token", id: token.id }));
}
