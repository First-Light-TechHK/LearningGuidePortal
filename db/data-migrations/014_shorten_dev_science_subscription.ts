import { createHash } from "node:crypto";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { ProductEntitlement, ProductPlan, ProductSubscription, ProductUser } from "../../services/productStore";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "014_shorten_dev_science_subscription";
export const description = "Shorten one DEV six-month Science purchase to 27 October 2026 at midnight Asia/Shanghai for expiry testing.";
export const touches = ["subscriptions", "entitlements"] as const;

// Keep the requested account's plaintext email out of source and deployment logs.
const TARGET_EMAIL_SHA256 = "60f9991e6fd17108afe2bd69ec3483fbf5068cb4de3d5b89dc69b0f51a7a9f3d";
export const validTo = "2026-10-26T16:00:00.000Z";
const purchaseDayStart = Date.parse("2026-10-25T16:00:00.000Z");
const purchaseDayEnd = Date.parse(validTo);
const originalEndDayStart = Date.parse("2027-04-25T16:00:00.000Z");
const originalEndDayEnd = Date.parse("2027-04-26T16:00:00.000Z");

/** Parameterised account selector lets tests use synthetic accounts only. */
export function applyForAccount(orm: MigrationOrm, ctx: DataMigrationContext, emailSha256: string): DataChange[] {
  // Product reads also run migrations locally. This override belongs only to
  // the DEV PostgreSQL migration transaction (including its operator dry-run).
  if (process.env.APP_ENV !== "DEV" || process.env.DATA_S3_PREFIX !== "learning-guide/dev" || ctx.store !== "sql") {
    return [{ action: "skip", kind: "subscription", id, reason: "dev-sql-only" }];
  }

  const users = orm.table<ProductUser>("users").find(user => user.email !== null
    && createHash("sha256").update(user.email.trim().toLowerCase()).digest("hex") === emailSha256);
  if (users.length !== 1) throw new Error(`${id}: expected exactly one target DEV account; found ${users.length}.`);

  const plans = orm.table<ProductPlan>("plans");
  const subscriptions = orm.table<ProductSubscription>("subscriptions");
  const candidates = subscriptions.find(subscription => {
    const plan = plans.findById(subscription.planId);
    const start = Date.parse(subscription.validFrom);
    return subscription.userId === users[0].id && subscription.source === "purchase"
      && subscription.scope === "category" && subscription.scopeId === "Science"
      && plan?.termMonths === 6 && plan.scope === "category" && (plan.scopeId || plan.category) === "Science"
      && start >= purchaseDayStart && start < purchaseDayEnd;
  });
  if (candidates.length !== 1) throw new Error(`${id}: expected exactly one Science six-month purchase starting on 2026-10-26 Asia/Shanghai; found ${candidates.length}.`);
  const subscription = candidates[0];
  const oldEnd = Date.parse(subscription.validTo);
  const alreadyShortened = oldEnd === Date.parse(validTo);
  if (!alreadyShortened && (!(oldEnd >= originalEndDayStart && oldEnd < originalEndDayEnd)
    || !["active", "cancel_at_period_end"].includes(subscription.state) || subscription.graceEndsAt)) {
    throw new Error(`${id}: subscription no longer has its original six-month period; refusing to overwrite it.`);
  }

  const entitlements = orm.table<ProductEntitlement>("entitlements");
  const matching = entitlements.find(entitlement => entitlement.userId === subscription.userId
    && entitlement.source === "purchase" && entitlement.scope === "category" && entitlement.scopeId === "Science"
    && (entitlement.device || "pc") === (subscription.device || plans.findById(subscription.planId)?.device || "pc")
    && Date.parse(entitlement.validTo) === oldEnd && entitlement.state !== "revoked");
  if (matching.length !== 1) throw new Error(`${id}: expected exactly one matching Science purchase entitlement; found ${matching.length}.`);
  if (alreadyShortened) return [{ action: "skip", kind: "subscription", id: subscription.id, reason: "already-shortened" }];
  if (matching[0].state !== "active") throw new Error(`${id}: original entitlement is not active; refusing to revive it.`);

  // All preconditions precede either write; the boot runner commits both rows
  // and its unique migration ledger entry in the same database transaction.
  subscriptions.update(subscription.id, { validTo });
  entitlements.update(matching[0].id, { validTo });
  return [
    { action: "update", kind: "subscription", id: subscription.id, reason: `validTo:${subscription.validTo}->${validTo}` },
    { action: "update", kind: "entitlement", id: matching[0].id, reason: `validTo:${matching[0].validTo}->${validTo}` },
  ];
}

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  return applyForAccount(orm, ctx, TARGET_EMAIL_SHA256);
}
