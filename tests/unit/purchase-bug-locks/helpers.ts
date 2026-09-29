import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

type ModuleMock = {
  module: (specifier: string, options: { namedExports?: Record<string, unknown>; defaultExport?: unknown }) => void;
};

export function mockModule(specifier: string, options: { namedExports?: Record<string, unknown>; defaultExport?: unknown }) {
  (mock as unknown as ModuleMock).module(specifier, options);
}

export async function isolateProductStore() {
  const originalCwd = process.cwd();
  const originalStorageBackend = process.env.STORAGE_BACKEND;
  const isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-purchase-locks-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  const store = await import("../../../services/productStore");
  return {
    store,
    cwd: isolatedCwd,
    async restore() {
      process.chdir(originalCwd);
      if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
      else process.env.STORAGE_BACKEND = originalStorageBackend;
      if (path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
    },
  };
}

export async function verifiedUser(store: Awaited<ReturnType<typeof isolateProductStore>>["store"], email: string) {
  const user = await store.registerUser({ email, password: "password1", nickname: "Purchase Lock" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  return user;
}
