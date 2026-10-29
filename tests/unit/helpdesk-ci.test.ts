// The Helpdesk learner browser specs (tests/e2e/helpdesk-support.spec.ts) run in
// the Verify workflow's "Build and test" job, after Chromium is installed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("CI runs the Helpdesk learner e2e after installing Chromium", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const install = workflow.indexOf("npx playwright install --with-deps chromium");
  const helpdesk = workflow.indexOf("run: npm run test:e2e:helpdesk");
  assert.ok(install > 0, "Chromium is installed");
  assert.ok(helpdesk > install, "npm run test:e2e:helpdesk runs after it");
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["test:e2e:helpdesk"], /playwright test --config=playwright\.helpdesk\.config\.ts/);
});
