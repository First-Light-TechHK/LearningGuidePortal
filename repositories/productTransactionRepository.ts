import { ensureSchema, getPool } from "@/services/persistence/db";
import { persistenceEnabled } from "@/services/persistence/config";

type PaymentData = {
  orders: Array<{ id: string; paymentMode: string; quoteId: string; stripeCheckoutSessionId?: string | null; stripeInvoiceId?: string | null }>;
  stripeEvents: Array<{ id: string }>;
};

// The existing product aggregate lives in app_files. Serialize its read/modify/write
// across App Runner instances and commit the aggregate and unique payment keys together.
export async function productTransaction<T, D extends PaymentData>(operation: () => Promise<{ data: D; result: T }>, localSave: (data: D) => Promise<void>) {
  if (!persistenceEnabled()) {
    const { data, result } = await operation();
    const keys = paymentKeys(data);
    if (new Set(keys.map(item => item[0] + ":" + item[1])).size !== keys.length) throw new Error("Duplicate payment identity.");
    await localSave(data);
    return result;
  }
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(719301, 1)");
    const { data, result } = await operation();
    for (const [kind, externalId, ownerId] of paymentKeys(data)) {
      const saved = await client.query(`INSERT INTO product_payment_keys(kind, external_id, owner_id) VALUES ($1, $2, $3)
        ON CONFLICT (kind, external_id) DO UPDATE SET owner_id = product_payment_keys.owner_id
        WHERE product_payment_keys.owner_id = EXCLUDED.owner_id RETURNING owner_id`, [kind, externalId, ownerId]);
      if (!saved.rowCount) throw new Error("Duplicate payment identity.");
    }
    const content = JSON.stringify(data);
    await client.query(`INSERT INTO app_files(path, storage, content, byte_size, content_type) VALUES ($1, 'db', $2, $3, 'application/json')
      ON CONFLICT (path) DO UPDATE SET storage = 'db', content = EXCLUDED.content, s3_key = NULL,
      byte_size = EXCLUDED.byte_size, content_type = 'application/json', updated_at = NOW()`, ["learning_guide/product.json", content, Buffer.byteLength(content)]);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

function paymentKeys(data: PaymentData) {
  const keys: string[][] = data.stripeEvents.map(event => ["event", event.id, event.id]);
  for (const order of data.orders.filter(item => item.paymentMode === "stripe")) {
    keys.push(["quote", order.quoteId, order.id]);
    if (order.stripeCheckoutSessionId) keys.push(["checkout", order.stripeCheckoutSessionId, order.id]);
    if (order.stripeInvoiceId) keys.push(["invoice", order.stripeInvoiceId, order.id]);
  }
  return keys;
}
