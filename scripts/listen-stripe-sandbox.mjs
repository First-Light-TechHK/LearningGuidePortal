import { spawn } from "node:child_process";

if (process.env.STRIPE_SANDBOX !== "1" || !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Sandbox test key required.");
const origin = new URL(process.env.NEXT_PUBLIC_APP_URL);
if (!["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("This listener only forwards to localhost.");
const child = spawn("stripe", ["listen", "--forward-to", `${origin.origin}/api/payment/webhook`, "--events", "checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,invoice.paid,invoice.payment_failed"],
  { env: { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY } });
for (const stream of [child.stdout, child.stderr]) {
  let buffered = "";
  stream.on("data", chunk => {
    buffered += chunk.toString();
    const lines = buffered.split("\n");
    buffered = lines.pop();
    for (const line of lines) console.log(line.replace(/whsec_[A-Za-z0-9]+/g, "[signing secret hidden]"));
  });
}
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code || 0; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
