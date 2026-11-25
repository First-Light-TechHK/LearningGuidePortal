import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const originalEnv = process.env.APP_ENV;

let Badge: ComponentType<{ locale: string }> | null = null;

/** Compile the server component with Next's automatic JSX runtime, like the app build. */
async function badgeComponent() {
  if (Badge) return Badge;
  const bundle = await build({
    stdin: { contents: 'export { SandboxEnvironmentBadge } from "./components/portal/SandboxEnvironmentBadge";', resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"),
    external: ["react", "react/jsx-runtime", "react-dom/server"],
    loader: { ".css": "empty" },
  });
  const outputDir = path.join(root, "test-results", "sandbox-environment-badge");
  await mkdir(outputDir, { recursive: true });
  const file = path.join(outputDir, "badge.cjs");
  await writeFile(file, bundle.outputFiles[0]!.text);
  Badge = createRequire(import.meta.url)(file).SandboxEnvironmentBadge as ComponentType<{ locale: string }>;
  return Badge;
}

async function render(locale: string) {
  return renderToStaticMarkup(createElement(await badgeComponent(), { locale }));
}

afterEach(() => {
  if (originalEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = originalEnv;
});

test("SANDBOX renders a prominent bilingual status banner", async () => {
  process.env.APP_ENV = "SANDBOX";

  const english = await render("en-GB");
  assert.match(english, /data-environment="sandbox"/);
  assert.match(english, /role="status"/);
  assert.match(english, /Sandbox environment — test courses and test payments only/);
  assert.match(english, /sandbox-environment-badge/);

  const chinese = await render("zh-CN");
  assert.match(chinese, /沙盒环境/);
  assert.match(chinese, /请勿使用真实银行卡/);
});

test("SIT, UAT, PROD and DEV render no banner", async () => {
  for (const environment of ["SIT", "UAT", "PROD", "PPE/PROD", "DEV"]) {
    process.env.APP_ENV = environment;
    assert.equal(await render("en-GB"), "", `${environment} must not show the Sandbox banner`);
  }
});
