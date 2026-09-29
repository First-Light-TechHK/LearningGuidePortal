import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hideAwsCredentials, loadPortalPage, MIGRATED_COVER } from "./helpers/portal-page-harness";

// Expected to fail until a cover that cannot be signed returns a fallback
// and portal home / courses keep rendering without AWS credentials.

const originalCwd = process.cwd();
let isolatedCwd = "";

before(async () => {
  hideAwsCredentials();
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-cover-signing-"));
  process.chdir(isolatedCwd);
});

after(async () => {
  process.chdir(originalCwd);
  if (isolatedCwd) await rm(isolatedCwd, { recursive: true, force: true });
});

test("a cover URL that cannot be signed must return a fallback instead of CredentialsProviderError", async () => {
  const { signCourseMediaUrl } = await import("../../services/persistence/s3");
  let signed = "";
  try {
    signed = await signCourseMediaUrl(MIGRATED_COVER);
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    assert.fail(`signCourseMediaUrl threw ${name}: a cover URL that cannot be signed must return a fallback instead of taking down the page (${error instanceof Error ? error.message : error})`);
  }
  assert.equal(typeof signed, "string");
  assert.equal(signed.includes("X-Amz-Algorithm"), false);
});

test("portal home and courses cover signing must not throw CredentialsProviderError when STORAGE_BACKEND=local and AWS credentials are absent", async () => {
  const { listPublishedCourses } = await import("../../services/productStore");
  const { signCourseMediaUrl } = await import("../../services/persistence/s3");
  const courses = await listPublishedCourses();
  const signable = courses.filter((course) => (course.cover || course.thumbnailPath || "").includes("amazonaws.com"));
  assert.ok(signable.length > 0, "migrations 003/004 should publish a cover that has to be signed");
  try {
    await Promise.all(courses.map((course) => signCourseMediaUrl(course.cover || course.thumbnailPath || "")));
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    assert.fail(`signing published covers threw ${name}: GET /portal and /portal/courses must not 500 when a cover cannot be signed (${error instanceof Error ? error.message : error})`);
  }
});

test("portal home and courses page handlers must not throw CredentialsProviderError when a cover cannot be signed", async () => {
  const home = await loadPortalPage("app/[locale]/portal/page.tsx");
  const courses = await loadPortalPage("app/[locale]/portal/courses/page.tsx");
  try {
    await home.default({ params: Promise.resolve({ locale: "en-GB" }) } as never);
    await courses.default({ params: Promise.resolve({ locale: "en-GB" }), searchParams: Promise.resolve({}) } as never);
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    assert.fail(`portal page handler threw ${name}: GET /portal and /portal/courses must not 500 when a cover cannot be signed and AWS credentials are absent (${error instanceof Error ? error.message : error})`);
  }
});
