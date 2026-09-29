import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hideAwsCredentials, loadPortalPage, redirectDigest } from "./helpers/portal-page-harness";

// requirements-map: 游客可浏览已发布课程和 Public First Lesson.
// Expected to fail while those routes 307 to sign-in.

const originalCwd = process.cwd();
let isolatedCwd = "";

before(async () => {
  hideAwsCredentials();
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-visitor-course-"));
  process.chdir(isolatedCwd);
});

after(async () => {
  process.chdir(originalCwd);
  if (isolatedCwd) await rm(isolatedCwd, { recursive: true, force: true });
});

async function assertVisitorCanOpen(entry: string, props: unknown, pathName: string) {
  const page = await loadPortalPage(entry);
  try {
    await page.default(props as never);
  } catch (error) {
    const digest = redirectDigest(error);
    assert.equal(
      digest.includes("sign-in"),
      false,
      `signed-out GET ${pathName} must not 307 to sign-in (${digest.trim()})`,
    );
    throw error;
  }
}

test("a signed-out visitor can open /en-GB/portal/courses/epicureanism without a 307 to sign-in", async () => {
  await assertVisitorCanOpen(
    "app/[locale]/portal/courses/[slug]/page.tsx",
    { params: Promise.resolve({ locale: "en-GB", slug: "epicureanism" }) },
    "/en-GB/portal/courses/epicureanism",
  );
});

test("a signed-out visitor can open /en-GB/portal/courses/epicureanism/public-lesson without a 307 to sign-in", async () => {
  await assertVisitorCanOpen(
    "app/[locale]/portal/courses/[slug]/public-lesson/page.tsx",
    { params: Promise.resolve({ locale: "en-GB", slug: "epicureanism" }), searchParams: Promise.resolve({}) },
    "/en-GB/portal/courses/epicureanism/public-lesson",
  );
});
