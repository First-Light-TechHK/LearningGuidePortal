/**
 * COPY ME. Teaching material only. Scaffold a real file, then paste.
 *   npm run data:migration:new -- seed_dev_operator
 *
 * DEV-only login seed. No plaintext password in git. This user signs in with Google
 * (or WeChat) after the row exists. passwordHash stays null on purpose.
 */
import type { ProductAccount, ProductUser } from "../../../services/productStore";
import type { MigrationOrm } from "../../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "../types";

export const id = "096_example_seed_dev_operator";
export const description = "Seed the DEV operator login user and Google account if missing.";
export const touches = ["users", "accounts"] as const;

const USER_ID = "user-dev-operator";
const ACCOUNT_ID = "account-dev-operator-google";
const EMAIL = "dev.operator@example.test";
const GOOGLE_SUBJECT = "replace-with-google-sub";

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const users = orm.table<ProductUser>("users");
  const accounts = orm.table<ProductAccount>("accounts");
  const existing = users.find((item) => item.id === USER_ID || item.email === EMAIL)[0];
  if (existing && accounts.findById(ACCOUNT_ID)) {
    return [{ action: "skip", kind: "user", id: existing.id, reason: "exists" }];
  }
  if (!existing) {
    users.insert({
      id: USER_ID,
      email: EMAIL,
      passwordHash: null,
      nickname: "Dev Operator",
      locale: "en-GB",
      role: "operator",
      status: "active",
      emailVerifiedAt: ctx.now,
      createdAt: ctx.now,
    });
  }
  const userId = existing?.id || USER_ID;
  if (!accounts.findById(ACCOUNT_ID) && !accounts.find((item) => item.provider === "google" && item.providerSubject === GOOGLE_SUBJECT).length) {
    accounts.insert({
      id: ACCOUNT_ID,
      userId,
      provider: "google",
      providerSubject: GOOGLE_SUBJECT,
      createdAt: ctx.now,
    });
  }
  return [{ action: "add", kind: "user", id: userId }];
}
