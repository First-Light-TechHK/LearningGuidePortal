import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import path from "path";

const subscriptionProductImages = {
  everything: "/portal/subscriptions/everything.png",
  "chinese humanities": "/portal/subscriptions/chinese_human.png",
  "european humanities": "/portal/subscriptions/european_human.png",
  science: "/portal/subscriptions/science.png",
};

const root = process.cwd();
const productFile = path.join(root, "data", "knowledge_system", "learning_guide", "product.json");

function productKey(plan) {
  if (!plan) return null;
  if (plan.scope === "everything") return "everything";
  const label = plan.scopeId || plan.category || plan.name || "";
  const normalised = label.toLowerCase();
  if (normalised.includes("chinese humanities")) return "chinese humanities";
  if (normalised.includes("european humanities")) return "european humanities";
  if (normalised.includes("science")) return "science";
  if (normalised.includes("everything")) return "everything";
  return null;
}

function localSubscriptionProductImage(plan) {
  const key = productKey(plan);
  return key ? subscriptionProductImages[key] || null : null;
}

function publicImageExists(imagePath) {
  return existsSync(path.join(root, "public", imagePath.replace(/^\//, "")));
}

function planFor(record, data) {
  return record.planSnapshot || data.plans?.find((plan) => plan.id === record.planId) || null;
}

function fillCollection(name, data) {
  let updated = 0;
  for (const record of data[name] || []) {
    if (!record.price || record.price.productImage) continue;
    const image = localSubscriptionProductImage(planFor(record, data));
    if (!image || !publicImageExists(image)) continue;
    record.price.productImage = image;
    updated += 1;
  }
  return updated;
}

const data = JSON.parse(await readFile(productFile, "utf8"));
const orders = fillCollection("orders", data);
const quotes = fillCollection("quotes", data);
if (orders || quotes) {
  await writeFile(productFile, JSON.stringify(data, null, 2) + "\n", "utf8");
}
console.log(`Backfilled subscription product images: ${orders} orders, ${quotes} quotes.`);
