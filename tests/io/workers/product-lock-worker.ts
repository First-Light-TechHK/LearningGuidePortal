export {};

type WorkerResult = {
  ok: boolean;
  action: string;
  id?: string;
  orderId?: string;
  error?: string;
};

async function writeResult(result: WorkerResult) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function activate(store: typeof import("../../../services/productStore"), userId: string) {
  const token = await store.issueEmailVerificationToken(userId, true);
  await store.verifyEmailToken(token);
}

async function main() {
  const action = process.argv[2];
  if (!action) {
    await writeResult({ ok: false, action: "unknown", error: "usage: product-lock-worker <register|checkout|trial>" });
    process.exit(2);
  }
  if (process.env.LG_IO_CWD) process.chdir(process.env.LG_IO_CWD);
  process.env.STORAGE_BACKEND = "local";
  delete process.env.DATABASE_URL;

  const store = await import("../../../services/productStore");
  const email = process.env.LG_IO_EMAIL || "";
  const password = process.env.LG_IO_PASSWORD || "";
  const quoteId = process.env.LG_IO_QUOTE_ID || "";

  try {
    if (action === "register") {
      const user = await store.registerUser({ email, password, nickname: "IO Worker", locale: "en-GB" });
      await activate(store, user.id);
      await writeResult({ ok: true, action, id: user.id });
      return;
    }

    const user = await store.authenticateUser(email, password);
    if (action === "checkout") {
      const pending = await store.createPendingDemoOrder(user.id, quoteId);
      await writeResult({ ok: true, action, id: user.id, orderId: pending.order.id });
      return;
    }
    if (action === "trial") {
      const pending = await store.createPendingDemoTrialOrderFromQuote(user.id, quoteId);
      await writeResult({ ok: true, action, id: user.id, orderId: pending.order.id });
      return;
    }

    await writeResult({ ok: false, action, error: `unknown action ${action}` });
    process.exit(2);
  } catch (error) {
    await writeResult({
      ok: false,
      action,
      error: error instanceof Error ? error.message : "worker failed"
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
