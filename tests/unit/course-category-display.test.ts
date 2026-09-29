import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { courseCategoryId, courseCategoryLabel } from "../../lib/courseDetailPresentation";
import { courseIdentityFrom } from "../../lib/coursePage";
import { defaultPortalContent } from "../../lib/portalContent";

const categories = defaultPortalContent.categories;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const humanities = {
  title: "Quintus Horatius Flaccus",
  category: "European Humanities" as const,
  categoryId: "european-humanities",
  subjectId: "poetry",
};
const science = {
  title: "Biology",
  category: "Science" as const,
  categoryId: "science",
  subjectId: "biology",
};
// Legacy field stamped to humanities while the stored category id is science.
const scienceStampedAsHumanities = {
  title: "Biology",
  category: "European Humanities" as const,
  categoryId: "science",
};
const uncategorised = { title: "Untitled", category: null, categoryId: null, subjectId: null };

test("displayed category label matches the course category in en-GB and zh-CN", () => {
  assert.equal(courseCategoryLabel(humanities, categories, "en-GB"), "European Humanities");
  assert.equal(courseCategoryLabel(humanities, categories, "zh-CN"), "欧洲人文");
  assert.equal(courseCategoryLabel(science, categories, "en-GB"), "Science");
  assert.equal(courseCategoryLabel(science, categories, "zh-CN"), "科学");

  assert.equal(courseCategoryLabel(science, categories, "en-GB").includes("Humanities"), false);
  assert.equal(courseCategoryLabel(science, categories, "zh-CN").includes("人文"), false);
  assert.equal(courseCategoryLabel(humanities, categories, "en-GB").includes("Science"), false);
  assert.equal(courseCategoryLabel(humanities, categories, "zh-CN").includes("科学"), false);

  assert.equal(courseCategoryId(science, categories), "Science");
  assert.equal(courseCategoryId(humanities, categories), "European Humanities");
  assert.notEqual(courseCategoryId(science, categories), courseCategoryId(humanities, categories));
});

test("a science categoryId is not displayed as European Humanities", () => {
  assert.equal(courseCategoryId(scienceStampedAsHumanities, categories), "Science");
  assert.equal(courseCategoryLabel(scienceStampedAsHumanities, categories, "en-GB"), "Science");
  assert.equal(courseCategoryLabel(scienceStampedAsHumanities, categories, "zh-CN"), "科学");
  assert.equal(courseCategoryLabel(scienceStampedAsHumanities, categories, "zh-CN").includes("人文"), false);

  const catalogue = [
    { id: "cat-science", name: "Science", parentId: null },
    { id: "biology", name: "Biology", parentId: "cat-science" },
  ];
  const byCatalogue = { title: "Biology", category: "European Humanities" as const, categoryId: "cat-science", subjectId: "biology" };
  assert.equal(courseCategoryId(byCatalogue, categories, catalogue), "Science");
  assert.equal(courseCategoryLabel(byCatalogue, categories, "zh-CN", catalogue), "科学");

  const bySubject = { title: "Biology", category: null, categoryId: null, subjectId: "biology" };
  assert.equal(courseCategoryId(bySubject, categories, catalogue), "Science");
  assert.equal(courseCategoryLabel(bySubject, categories, "en-GB", catalogue), "Science");
});

test("a course with no category does not borrow a humanities or science label", () => {
  assert.equal(courseCategoryId(uncategorised, categories), "");
  assert.equal(courseCategoryLabel(uncategorised, categories, "en-GB"), "");
  assert.equal(courseCategoryLabel(uncategorised, categories, "zh-CN"), "");
  assert.equal(courseIdentityFrom({ ...uncategorised, status: "published", sections: [] }).track, "");
  assert.notEqual(courseIdentityFrom({ ...uncategorised, status: "published", sections: [] }).track, "European Humanities");
  assert.notEqual(courseIdentityFrom({ ...uncategorised, status: "published", sections: [] }).track, "Science");
});

test("course identity track follows the stored category, not a hardcoded humanities string", () => {
  assert.equal(courseIdentityFrom({ ...humanities, status: "published", sections: [] }).track, "European Humanities");
  assert.equal(courseIdentityFrom({ ...science, status: "published", sections: [] }).track, "Science");
  assert.equal(courseIdentityFrom({ ...scienceStampedAsHumanities, status: "published", sections: [] }).track, "Science");
});

test("catalogue and course pages do not file a course under European Humanities by default", () => {
  const files = [
    "lib/coursePage.ts",
    "app/[locale]/portal/page.tsx",
    "app/[locale]/portal/courses/page.tsx",
    "app/[locale]/portal/courses/[slug]/page.tsx",
    "app/[locale]/pricing/page.tsx",
    "services/productStore.ts",
  ];
  for (const relative of files) {
    const source = readFileSync(path.join(root, relative), "utf8");
    assert.equal(source.includes('course.category || "European Humanities"'), false, relative);
    assert.equal(source.includes('course?.category || "European Humanities"'), false, relative);
    assert.equal(source.includes('course.category ||= "European Humanities"'), false, relative);
  }
  const detail = readFileSync(path.join(root, "app/[locale]/portal/courses/[slug]/page.tsx"), "utf8");
  assert.match(detail, /courseCategoryLabel\(/);
  const catalogue = readFileSync(path.join(root, "app/[locale]/portal/courses/page.tsx"), "utf8");
  assert.match(catalogue, /courseCategoryId\(/);
  assert.match(catalogue, /courseCategoryLabel\(/);
});
