// The Helpdesk learner browser specs (tests/e2e/helpdesk-support.spec.ts) run in
// CI: npm run test:ci → test:integration → test:e2e:helpdesk, and the Verify
// workflow runs test:ci after installing Chromium. The suite's dev server keeps
// out of .next, where CI's production build lives.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("test:ci runs the Helpdesk learner e2e, and CI runs test:ci after installing Chromium", () => {
  const { scripts } = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.match(scripts["test:ci"], /npm run test:integration/);
  assert.match(scripts["test:integration"], /npm run test:e2e:helpdesk/);
  assert.match(scripts["test:e2e:helpdesk"], /playwright test --config=playwright\.helpdesk\.config\.ts/);
  const workflow = read(".github/workflows/ci.yml");
  const install = workflow.indexOf("npx playwright install --with-deps chromium");
  assert.ok(install > 0 && workflow.indexOf("run: npm run test:ci") > install);
  const config = read("playwright.helpdesk.config.ts");
  assert.match(config, /NEXT_DIST_DIR: "\.next-ui-check"/);
  assert.match(config, /globalTeardown: "\.\/tests\/e2e\/helpdesk-global-teardown\.ts"/, "next-env.d.ts is pointed back at .next");
  assert.match(read("tsconfig.json"), /"\.next-ui-check\/types\/\*\*\/\*\.ts"/, "the dev server's types are already included, so next dev leaves tsconfig alone");
});
