import nextEnv from "@next/env";
import { spawn } from "node:child_process";

nextEnv.loadEnvConfig(process.cwd(), true);
const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
  throw new Error("Local Stripe forwarding requires a localhost NEXT_PUBLIC_APP_URL.");
}
const destination = `${origin.origin}/api/payment/webhook`;
console.log(`Forwarding Stripe events to ${destination}`);
const listener = spawn("stripe", ["listen", "--forward-to", destination], { stdio: "inherit", windowsHide: true });
listener.on("error", () => {
  console.error("Stripe CLI is unavailable. Install Stripe CLI and run stripe login before retrying.");
  process.exitCode = 1;
});
listener.on("exit", code => { process.exitCode = code || 0; });
