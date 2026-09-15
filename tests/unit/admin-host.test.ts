import assert from "node:assert/strict";
import { test } from "node:test";
import { adminHostDecision, adminHosts, isAdminHost } from "../../services/adminHost";

function request(url: string, host: string) {
  return new Request(url, { headers: { host } });
}

test("default admin hosts are the two operator sites", () => {
  const previous = process.env.ADMIN_HOSTS;
  const appEnv = process.env.APP_ENV;
  try {
    delete process.env.ADMIN_HOSTS;
    process.env.APP_ENV = "SIT";
    assert.deepEqual(adminHosts(), ["admin.ilovelearningguide.com", "admin.sit.ilovelearningguide.com"]);
    process.env.APP_ENV = "DEV";
    assert.ok(adminHosts().includes("localhost"));
    assert.ok(adminHosts().includes("admin.ilovelearningguide.com"));
  } finally {
    if (previous === undefined) delete process.env.ADMIN_HOSTS;
    else process.env.ADMIN_HOSTS = previous;
    if (appEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = appEnv;
  }
});

test("www and sit learner hosts are not admin hosts", () => {
  const previous = process.env.ADMIN_HOSTS;
  try {
    delete process.env.ADMIN_HOSTS;
    assert.equal(isAdminHost(request("https://www.ilovelearningguide.com/", "www.ilovelearningguide.com")), false);
    assert.equal(isAdminHost(request("https://sit.ilovelearningguide.com/", "sit.ilovelearningguide.com")), false);
    assert.equal(isAdminHost(request("https://admin.ilovelearningguide.com/", "admin.ilovelearningguide.com")), true);
    assert.equal(isAdminHost(request("https://admin.sit.ilovelearningguide.com/", "admin.sit.ilovelearningguide.com")), true);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_HOSTS;
    else process.env.ADMIN_HOSTS = previous;
  }
});

test("learner hosts hide backoffice pages and APIs", () => {
  for (const host of ["www.ilovelearningguide.com", "sit.ilovelearningguide.com", "ilovelearningguide.com"]) {
    assert.equal(adminHostDecision(request("https://" + host + "/en-GB/backoffice/courses", host)).status, 404);
    assert.equal(adminHostDecision(request("https://" + host + "/api/backoffice/courses", host)).status, 404);
    assert.equal(adminHostDecision(request("https://" + host + "/en-GB/portal", host)).allow, true);
  }
});

test("admin hosts keep backoffice and send portal traffic there", () => {
  const admin = "admin.ilovelearningguide.com";
  const sitAdmin = "admin.sit.ilovelearningguide.com";
  for (const host of [admin, sitAdmin]) {
    assert.equal(adminHostDecision(request("https://" + host + "/en-GB/backoffice/sign-in", host)).allow, true);
    assert.equal(adminHostDecision(request("https://" + host + "/api/backoffice/courses", host)).allow, true);
    assert.equal(adminHostDecision(request("https://" + host + "/api/auth/admin/login", host)).allow, true);
    const home = adminHostDecision(request("https://" + host + "/", host));
    assert.equal(home.status, 307);
    assert.equal(home.location, "/en-GB/backoffice");
    const portal = adminHostDecision(request("https://" + host + "/en-GB/portal/sign-in", host));
    assert.equal(portal.status, 307);
    assert.equal(portal.location, "/en-GB/backoffice");
    assert.equal(adminHostDecision(request("https://" + host + "/api/portal-media/media_aaaaaaaaaaaaaaaa", host)).allow, true);
  }
});
