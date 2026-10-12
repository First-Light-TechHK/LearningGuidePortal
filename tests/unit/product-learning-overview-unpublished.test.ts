import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { COURSE_ID, purchaseCourse, verifiedUser } from "./helpers/my-learning";

// Break: D2 — My Learning keeps presenting a course as "Current access" after the
// course is archived or drafted. getLearningOverview's returned `entitlements`
// (header badge, app/[locale]/account/my-learning/page.tsx) has no
// course-existence/published check, while checkEntitlement requires
// status === "published" — so the portal claims owned access that the Study
// Group dropdown correctly refuses.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-product-learning-overview-unpublished-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test("learning overview must not present an unpublished course as current access", async () => {
  const user = await verifiedUser(store, "d2-unpublished@example.test");
  await purchaseCourse(store, user.id);

  // Control: while the course is published, the active entitlement is presented
  // as current access (the badge is non-empty and the course is in the list).
  const published = await store.getLearningOverview(user.id);
  assert.equal(
    published.entitlements.some((item) => item.userId === user.id),
    true,
    "control: a published course's active entitlement is current access",
  );

  // The course is taken out of publication after purchase.
  assert.equal((await store.setCourseStatus(COURSE_ID, "draft")).status, "draft");
  assert.equal(
    (await store.checkEntitlement(user.id, COURSE_ID)).allowed,
    false,
    "control: an unpublished course denies entitlement checks",
  );

  // D2 — desired: the "Current access" list follows the same published-course
  // rule as checkEntitlement; currently the draft course's active entitlement is
  // still returned and rendered as current access.
  const overview = await store.getLearningOverview(user.id);
  assert.equal(
    overview.entitlements.filter((item) => item.userId === user.id).length,
    0,
    "D2: an entitlement for an unpublished course must not be presented as current access (overview filter ignores course status while checkEntitlement requires published)",
  );

  // Republishing restores current access (guards against over-filtering).
  await store.setCourseStatus(COURSE_ID, "published");
  const republished = await store.getLearningOverview(user.id);
  assert.equal(
    republished.entitlements.some((item) => item.userId === user.id),
    true,
    "republishing the course restores current access",
  );
});
