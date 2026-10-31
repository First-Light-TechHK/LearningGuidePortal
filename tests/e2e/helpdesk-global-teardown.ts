// next dev rewrites next-env.d.ts to reference its distDir's route types. The
// Helpdesk e2e dev server writes to .next-ui-check (playwright.helpdesk.config.ts),
// so point the reference back at .next afterwards and leave the work tree clean.
import { readFile, writeFile } from "node:fs/promises";

export default async function globalTeardown() {
  const file = "next-env.d.ts";
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return;
  const restored = text.replace("./.next-ui-check/types/", "./.next/types/");
  if (restored !== text) await writeFile(file, restored);
}
