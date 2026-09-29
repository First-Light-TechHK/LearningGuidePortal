import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const port = process.env.BUG_LOCK_PORT || "4312";

function stripPrivateMedia(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.includes("amazonaws.com") || value.includes("myqcloud.com")) return "";
    return value;
  }
  if (Array.isArray(value)) return value.map(stripPrivateMedia);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripPrivateMedia(item)]));
  }
  return value;
}

async function main() {
  const work = await mkdtemp(path.join(tmpdir(), "lg-bug-lock-render-"));
  // Next does not pick up a symlinked app directory, so copy the source tree.
  await cp(root, work, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(root, source);
      if (!relative || relative === ".") return true;
      const top = relative.split(path.sep)[0];
      return !["node_modules", ".next", ".git", "data"].includes(top);
    },
  });
  await symlink(path.join(root, "node_modules"), path.join(work, "node_modules"));

  process.chdir(work);
  const store = await import("../../../services/productStore");
  const seeded = await store.ensureProductData();
  const printable = stripPrivateMedia(seeded);
  const productFile = path.join(work, "data", "knowledge_system", "learning_guide", "product.json");
  await mkdir(path.dirname(productFile), { recursive: true });
  await writeFile(productFile, `${JSON.stringify(printable, null, 2)}\n`);

  const child = spawn(process.execPath, [
    path.join(root, "node_modules/next/dist/bin/next"),
    "dev",
    work,
    "--hostname",
    "127.0.0.1",
    "-p",
    port,
  ], { cwd: work, env: process.env, stdio: "inherit" });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
