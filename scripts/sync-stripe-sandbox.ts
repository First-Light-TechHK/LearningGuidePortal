import { stripePlanDefinitions } from "../services/stripePrices";
import { resolveStripePrice } from "../services/stripeClient";
import { syncSandboxStripePlans, type ProductPlan } from "../services/productStore";
import { getPool } from "../services/persistence/db";

async function syncCloudPlans(plans: ProductPlan[]) {
  if (process.env.CONFIRM_SANDBOX_CATALOGUE !== "learning-guide/dev" || process.env.DATA_S3_PREFIX !== "learning-guide/dev" || process.env.APP_ENV !== "DEV") {
    throw new Error("Cloud catalogue update requires explicit Learning Guide DEV confirmation.");
  }
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await db.query("SELECT storage, content FROM app_files WHERE path = $1 FOR UPDATE", ["learning_guide/product.json"]);
    const row = result.rows[0];
    if (!row || row.storage !== "db") throw new Error("Expected an existing database catalogue; no data was changed.");
    const data = JSON.parse(row.content);
    if (!Array.isArray(data.plans) || !Array.isArray(data.quotes)) throw new Error("Unexpected catalogue structure.");
    const changed = new Set<string>();
    for (const plan of plans) {
      const existing = data.plans.find((item: ProductPlan) => item.id === plan.id);
      if (!existing || existing.amountMinor !== plan.amountMinor || existing.currency !== plan.currency) changed.add(plan.id);
      if (existing) Object.assign(existing, plan);
      else data.plans.push(plan);
    }
    for (const quote of data.quotes) if (changed.has(quote.planId)) quote.expiresAt = new Date().toISOString();
    const content = JSON.stringify(data);
    await db.query("UPDATE app_files SET content=$1, byte_size=$2, updated_at=NOW() WHERE path=$3", [content, Buffer.byteLength(content), "learning_guide/product.json"]);
    await db.query("COMMIT");
    return { plans: plans.length, changed: [...changed], storage: "postgresql", sandbox: true };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
    await pool.end();
  }
}

async function main() {
  if (process.env.STRIPE_SANDBOX !== "1" || !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Sandbox test key required.");
  const plans: ProductPlan[] = [];
  for (const definition of stripePlanDefinitions) {
    const price = await resolveStripePrice(definition.id, definition.months);
    plans.push({ id: definition.id, courseId: "*", name: `${definition.category || "Everything"} · PC · ${definition.months} months`,
      termMonths: definition.months, device: "pc", amountMinor: price.unit_amount!, currency: "usd",
      scope: definition.category ? "category" : "everything", scopeId: definition.category || "*", category: definition.category,
      aiPoints: definition.category ? (definition.months === 6 ? 3000 : 6500) : 10000, trialEligible: true });
    console.log(JSON.stringify({ plan: definition.id, price: price.id, amountMinor: price.unit_amount, currency: price.currency, months: definition.months, sandbox: !price.livemode }));
  }
  console.log(JSON.stringify(await (process.argv.includes("--cloud") ? syncCloudPlans(plans) : syncSandboxStripePlans(plans))));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
