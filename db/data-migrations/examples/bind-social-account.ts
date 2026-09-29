/**
 * COPY ME. Teaching material only. Scaffold a real file, then paste.
 *   npm run data:migration:new -- bind_qa_wechat
 *
 * Links a social login to a user who already exists. Does not create a second user.
 */
import type { ProductAccount, ProductUser } from "../../../services/productStore";
import type { MigrationOrm } from "../../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "../types";

export const id = "097_example_bind_social_account";
export const description = "Bind a WeChat login to the QA teacher if that account is not linked yet.";
export const touches = ["accounts"] as const;

const EMAIL = "qa.teacher@example.test";
const ACCOUNT_ID = "account-qa-teacher-wechat";
const PROVIDER_SUBJECT = "replace-with-wechat-openid";

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const users = orm.table<ProductUser>("users");
  const accounts = orm.table<ProductAccount>("accounts");
  const user = users.find((item) => item.email === EMAIL)[0];
  if (!user) return [{ action: "skip", kind: "user", id: EMAIL, reason: "missing" }];
  if (accounts.find((item) => item.userId === user.id && item.provider === "wechat").length) {
    return [{ action: "skip", kind: "account", id: ACCOUNT_ID, reason: "exists" }];
  }
  accounts.insert({
    id: ACCOUNT_ID,
    userId: user.id,
    provider: "wechat",
    providerSubject: PROVIDER_SUBJECT,
    wechatOpenId: PROVIDER_SUBJECT,
    createdAt: ctx.now,
  });
  return [{ action: "add", kind: "account", id: ACCOUNT_ID }];
}
