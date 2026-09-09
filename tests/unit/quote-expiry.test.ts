import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Current productStore QUOTE_MINUTES is 15 and is not exported. Lock that window.
const CURRENT_QUOTE_MINUTES = 15;
const QUOTE_MS = CURRENT_QUOTE_MINUTES * 60_000;
const PLAN_ID = "epicureanism-pc-6";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-quote-expiry-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

function productFile() {
  return path.join(process.cwd(), "data", "knowledge_system", "learning_guide", "product.json");
}

test("createQuote sets expiresAt about 15 minutes from now", async () => {
  const user = await store.registerUser({
    email: "quote-ttl@example.test",
    password: "password1",
  });
  const before = Date.now();
  const { quote } = await store.createQuote(user.id, PLAN_ID);
  const after = Date.now();

  const expires = Date.parse(quote.expiresAt);
  assert.ok(Number.isFinite(expires), "expiresAt is a parseable timestamp");
  assert.ok(expires >= before + QUOTE_MS, "expiresAt is not earlier than create time + 15 minutes");
  assert.ok(expires <= after + QUOTE_MS, "expiresAt is not later than create time + 15 minutes");
});

test("getQuoteForUser returns null when quote.expiresAt is in the past", async () => {
  const user = await store.registerUser({
    email: "quote-expired@example.test",
    password: "password1",
  });
  const { quote } = await store.createQuote(user.id, PLAN_ID);

  const live = await store.getQuoteForUser(user.id, quote.id);
  assert.ok(live, "unexpired quote is still returned");
  assert.equal(live.quote.id, quote.id);

  const data = JSON.parse(await readFile(productFile(), "utf8"));
  const stored = data.quotes.find((item: { id: string }) => item.id === quote.id);
  assert.ok(stored, "created quote is on disk");
  stored.expiresAt = new Date(Date.now() - 1_000).toISOString();
  await writeFile(productFile(), `${JSON.stringify(data, null, 2)}\n`);

  assert.equal(await store.getQuoteForUser(user.id, quote.id), null);
});
