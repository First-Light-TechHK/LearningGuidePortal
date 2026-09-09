import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Leftover AUTH-05: two workers, same new email. Must not create two users
// or overwrite passwordHash. File lock + re-read is the current serialize.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const worker = path.join(repoRoot, "tests/unit/helpers/auth-05-worker.ts");
const registerPaths = path.join(repoRoot, "scripts/register-tsconfig-paths.cjs");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-auth-05-race-"));
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

function registerInWorker(email: string, password: string) {
  return new Promise<{ ok: true; id: string } | { ok: false; message: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import",
      "tsx",
      "--require",
      registerPaths,
      worker,
      email,
      password,
    ], {
      cwd: repoRoot,
      env: { ...process.env, STORAGE_BACKEND: "local", AUTH05_CWD: isolatedCwd },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        const parsed = JSON.parse(stdout) as { id: string };
        resolve({ ok: true, id: parsed.id });
        return;
      }
      resolve({ ok: false, message: stderr || stdout });
    });
  });
}

test("AUTH-05 leftover: concurrent same-email register keeps one user and one password", async () => {
  const email = "auth-05-race@example.test";
  const [first, second] = await Promise.all([
    registerInWorker(email, "password1"),
    registerInWorker(email, "attacker9"),
  ]);
  const wins = [first, second].filter((result) => result.ok);
  assert.equal(wins.length, 1, `expected one winner; results=${JSON.stringify([first, second])}`);
  const loser = [first, second].find((result) => !result.ok);
  assert.ok(loser && /already exists/i.test(loser.message), `loser must be already-exists, got ${loser?.message}`);

  const data = await store.ensureProductData();
  const users = data.users.filter((user) => user.email === email);
  assert.equal(users.length, 1);

  const winnerPassword = first.ok ? "password1" : "attacker9";
  const loserPassword = first.ok ? "attacker9" : "password1";
  await store.verifyEmailToken(await store.issueEmailVerificationToken(users[0].id));
  const signedIn = await store.authenticateUser(email, winnerPassword);
  assert.equal(signedIn.id, users[0].id);
  await assert.rejects(() => store.authenticateUser(email, loserPassword), /incorrect/);
});
