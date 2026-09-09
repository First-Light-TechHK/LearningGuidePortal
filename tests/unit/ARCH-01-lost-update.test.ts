import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "path";
import { fileURLToPath } from "node:url";

// Break: two writers of the same product.json last-write-wins and drop a user
// (ARCH-01 / LOAD-001). Lock only this merge behavior — no SLA.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const worker = path.join(repoRoot, "tests/unit/helpers/arch-01-worker.ts");
const registerPaths = path.join(repoRoot, "scripts/register-tsconfig-paths.cjs");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-arch-01-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
  await store.ensureProductData();
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

function registerInWorker(email: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import",
      "tsx",
      "--require",
      registerPaths,
      worker,
      email,
    ], {
      cwd: repoRoot,
      env: { ...process.env, STORAGE_BACKEND: "local", ARCH01_CWD: isolatedCwd },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`worker ${email} exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout);
    });
  });
}

test("ARCH-01: two workers registering different users must both persist", async () => {
  const emailA = "arch-01-a@example.test";
  const emailB = "arch-01-b@example.test";
  const [outA, outB] = await Promise.all([
    registerInWorker(emailA),
    registerInWorker(emailB),
  ]);
  const parsedA = JSON.parse(outA) as { id: string };
  const parsedB = JSON.parse(outB) as { id: string };
  assert.ok(parsedA.id);
  assert.ok(parsedB.id);

  const data = await store.ensureProductData();
  const emails = data.users.map((user) => user.email);
  assert.ok(emails.includes(emailA), `lost ${emailA}; users=${emails.join(",")}`);
  assert.ok(emails.includes(emailB), `lost ${emailB}; users=${emails.join(",")}`);
});
