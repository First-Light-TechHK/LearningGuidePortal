// The Helpdesk browser run has its own Playwright config, so the shared e2e
// config (and every existing spec it runs) is exactly as it was before
// Helpdesk: no ADMIN_HOSTS override, no Helpdesk env, one web server.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import e2eConfig from "../../playwright.e2e.config";
import helpdeskConfig from "../../playwright.helpdesk.config";
import { HELPDESK_E2E, helpdeskE2eServerEnv } from "../e2e/helpdesk-e2e-env";

type Server = { command: string; url: string; env?: Record<string, string>; reuseExistingServer?: boolean };
const servers = (value: unknown): Server[] => (Array.isArray(value) ? value : value ? [value] : []) as Server[];

test("playwright.e2e.config.ts carries no Helpdesk wiring and no ADMIN_HOSTS override", () => {
  const list = servers(e2eConfig.webServer);
  assert.equal(list.length, 1, "one web server, as before");
  const env = list[0].env ?? {};
  for (const key of ["ADMIN_HOSTS", ...Object.keys(helpdeskE2eServerEnv())]) assert.equal(key in env, false, key);
  const projects = (e2eConfig.projects ?? []).map((project) => project.name);
  assert.equal(projects.includes("e2e-helpdesk"), false);
  for (const project of e2eConfig.projects ?? []) {
    for (const match of ([] as unknown[]).concat(project.testMatch ?? [])) assert.doesNotMatch(String(match), /helpdesk/);
  }
});

test("the Helpdesk e2e config runs only helpdesk-support.spec.ts, on its own port, with the stub Admin and local-only env", () => {
  assert.deepEqual(([] as unknown[]).concat(helpdeskConfig.testMatch ?? []), ["**/helpdesk-support.spec.ts"]);
  const [portal, stub, ...rest] = servers(helpdeskConfig.webServer);
  assert.equal(rest.length, 0);
  assert.match(portal.command, /next dev --hostname 127\.0\.0\.1 -p 3014\b/);
  assert.equal(helpdeskConfig.use?.baseURL, "http://127.0.0.1:3014");
  const env = portal.env ?? {};
  assert.equal(env.APP_ENV, "DEV");
  assert.equal(env.STORAGE_BACKEND, "local");
  assert.equal(env.ADMIN_HOSTS, "admin.ilovelearningguide.com,admin.sit.ilovelearningguide.com");
  for (const [key, value] of Object.entries(helpdeskE2eServerEnv())) assert.equal(env[key], value, key);
  assert.match(stub.command, new RegExp(`helpdesk-admin-stub\\.mjs ${HELPDESK_E2E.adminPort} ${HELPDESK_E2E.adminToken}$`));
});

test("package.json runs the Helpdesk browser check through its own script", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["test:e2e:helpdesk"], /playwright test --config=playwright\.helpdesk\.config\.ts$/);
});
