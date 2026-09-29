import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { CourseLearningOutcomes } from "../../components/portal/CourseLearningOutcomes";
import { courseCategoryId, courseCategoryLabel, courseCategoryPlan, courseLearningOutcomes } from "../../lib/courseDetailPresentation";
import { courseIdentityFrom } from "../../lib/coursePage";
import { defaultPortalContent } from "../../lib/portalContent";
import type { ProductPlan } from "../../services/productStore";
import en from "../../messages/en-GB.json";
import zh from "../../messages/zh-CN.json";

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

const humanitiesStampedAsScience = {
  title: "Quintus Horatius Flaccus",
  category: "Science" as const,
  categoryId: "european-humanities",
  subjectId: "poetry",
};
const SCIENCE_OUTCOME_EN = "Model real biological systems mathematically";
const SCIENCE_OUTCOME_ZH = "用数学建模真实的生物系统";

test("a humanities categoryId is not displayed as Science", () => {
  assert.equal(courseCategoryId(humanitiesStampedAsScience, categories), "European Humanities");
  assert.equal(courseCategoryLabel(humanitiesStampedAsScience, categories, "en-GB"), "European Humanities");
  assert.equal(courseCategoryLabel(humanitiesStampedAsScience, categories, "zh-CN"), "欧洲人文");
  assert.equal(courseCategoryLabel(humanitiesStampedAsScience, categories, "en-GB").includes("Science"), false);
  assert.notEqual(courseCategoryLabel(humanitiesStampedAsScience, categories, "zh-CN"), "european-humanities");
  assert.notEqual(courseCategoryLabel(humanitiesStampedAsScience, categories, "zh-CN"), "science");
});

test("a subject displays as its parent portal category, not as the subject name", () => {
  const scienceParentNamedAsSubject = [
    { id: "science", name: "Biology", parentId: null },
    { id: "biology", name: "Biology", parentId: "science" },
  ];
  const biology = { title: "Cells", category: null, categoryId: null, subjectId: "biology" };
  assert.equal(courseCategoryId(biology, categories, scienceParentNamedAsSubject), "Science");
  assert.equal(courseCategoryLabel(biology, categories, "en-GB", scienceParentNamedAsSubject), "Science");
  assert.equal(courseCategoryLabel(biology, categories, "zh-CN", scienceParentNamedAsSubject), "科学");
  assert.equal(courseCategoryLabel(biology, categories, "en-GB", scienceParentNamedAsSubject).includes("Biology"), false);
  assert.equal(courseIdentityFrom({ ...biology, status: "published", sections: [] }, categories, scienceParentNamedAsSubject).track, "Science");

  const humanitiesParentNamedAsSubject = [
    { id: "european-humanities", name: "Poetry", parentId: null },
    { id: "poetry", name: "Poetry", parentId: "european-humanities" },
  ];
  const poetry = { title: "Horace", category: "Science" as const, categoryId: null, subjectId: "poetry" };
  assert.equal(courseCategoryId(poetry, categories, humanitiesParentNamedAsSubject), "European Humanities");
  assert.equal(courseCategoryLabel(poetry, categories, "en-GB", humanitiesParentNamedAsSubject), "European Humanities");
  assert.equal(courseCategoryLabel(poetry, categories, "zh-CN", humanitiesParentNamedAsSubject), "欧洲人文");
  assert.equal(courseCategoryLabel(poetry, categories, "en-GB", humanitiesParentNamedAsSubject).includes("Poetry"), false);
  assert.equal(courseCategoryLabel(poetry, categories, "en-GB", humanitiesParentNamedAsSubject).includes("Science"), false);
  assert.notEqual(courseCategoryLabel(poetry, categories, "zh-CN", humanitiesParentNamedAsSubject), "european-humanities");
  assert.equal(courseIdentityFrom({ ...poetry, status: "published", sections: [] }, categories, humanitiesParentNamedAsSubject).track, "European Humanities");
});

test("a catalogue name that names another portal category does not switch the displayed category", () => {
  const scienceNamedHumanities = [
    { id: "science", name: "European Humanities", parentId: null },
    { id: "biology", name: "Biology", parentId: "science" },
  ];
  const filedAsScience = { title: "Biology", category: "European Humanities" as const, categoryId: "science", subjectId: "biology" };
  assert.equal(courseCategoryId(filedAsScience, categories, scienceNamedHumanities), "Science");
  assert.equal(courseCategoryLabel(filedAsScience, categories, "en-GB", scienceNamedHumanities), "Science");
  assert.equal(courseCategoryLabel(filedAsScience, categories, "zh-CN", scienceNamedHumanities), "科学");
  assert.equal(courseCategoryLabel(filedAsScience, categories, "zh-CN", scienceNamedHumanities).includes("人文"), false);
  assert.notEqual(courseCategoryLabel(filedAsScience, categories, "zh-CN", scienceNamedHumanities), "science");

  const humanitiesNamedScience = [
    { id: "european-humanities", name: "Science", parentId: null },
    { id: "poetry", name: "Poetry", parentId: "european-humanities" },
  ];
  assert.equal(courseCategoryId(humanitiesStampedAsScience, categories, humanitiesNamedScience), "European Humanities");
  assert.equal(courseCategoryLabel(humanitiesStampedAsScience, categories, "en-GB", humanitiesNamedScience), "European Humanities");
  assert.equal(courseCategoryLabel(humanitiesStampedAsScience, categories, "zh-CN", humanitiesNamedScience), "欧洲人文");
  assert.equal(courseCategoryLabel(humanitiesStampedAsScience, categories, "en-GB", humanitiesNamedScience).includes("Science"), false);
  assert.notEqual(courseCategoryLabel(humanitiesStampedAsScience, categories, "zh-CN", humanitiesNamedScience), "european-humanities");
});

test("learning outcomes are the course's own list, never another category's list", () => {
  const humanitiesCourse = { title: "Horace", categoryId: "european-humanities", subjectId: "poetry" };
  const otherCategory = { id: "science", outcomes: [SCIENCE_OUTCOME_EN, SCIENCE_OUTCOME_ZH] };
  assert.deepEqual(courseLearningOutcomes(humanitiesCourse, [otherCategory]), []);
  const hidden = renderToStaticMarkup(createElement(CourseLearningOutcomes, {
    title: en.courseDetailDesign.outcomesTitle,
    outcomes: courseLearningOutcomes(humanitiesCourse, [otherCategory]),
  }));
  assert.equal(hidden, "");
  assert.equal(hidden.includes(SCIENCE_OUTCOME_EN), false);
  assert.equal(hidden.includes(SCIENCE_OUTCOME_ZH), false);
  assert.equal(en.courseDetailDesign.outcomes.includes(SCIENCE_OUTCOME_EN), true);
  assert.equal(zh.courseDetailDesign.outcomes.includes(SCIENCE_OUTCOME_ZH), true);

  const scienceCourse = {
    title: "Biology",
    categoryId: "science",
    outcomes: [`  ${SCIENCE_OUTCOME_EN}  `, "", SCIENCE_OUTCOME_ZH, SCIENCE_OUTCOME_EN],
  };
  assert.deepEqual(courseLearningOutcomes(scienceCourse, [otherCategory]), [SCIENCE_OUTCOME_EN, SCIENCE_OUTCOME_ZH]);
  const shown = renderToStaticMarkup(createElement(CourseLearningOutcomes, {
    title: zh.courseDetailDesign.outcomesTitle,
    outcomes: courseLearningOutcomes(scienceCourse),
  }));
  assert.match(shown, new RegExp(SCIENCE_OUTCOME_EN));
  assert.match(shown, new RegExp(SCIENCE_OUTCOME_ZH));

  const onOwnCatalogue = { title: "Biology", categoryId: "science", subjectId: "biology" };
  assert.deepEqual(courseLearningOutcomes(onOwnCatalogue, [
    { id: "biology", outcomes: ["Describe a cell"] },
    otherCategory,
  ]), ["Describe a cell"]);

  assert.deepEqual(courseLearningOutcomes({ categoryId: null, subjectId: null }, [otherCategory]), []);
  assert.deepEqual(courseLearningOutcomes(null, [otherCategory]), []);

  const page = readFileSync(path.join(root, "app/[locale]/portal/courses/[slug]/page.tsx"), "utf8");
  assert.doesNotMatch(page, /detail\.outcomes\.map/);
  assert.match(page, /courseLearningOutcomes\(/);
});

test("the category plan follows the portal category id, and an empty course is not offered European Humanities", () => {
  const sciencePlan = { id: "science-pc-6", courseId: "*", name: "Science", scope: "category" as const, scopeId: "Science", device: "pc" as const, termMonths: 6 as const, amountMinor: 4900, currency: "usd" as const, available: true };
  const humanitiesPlan: ProductPlan = { ...sciencePlan, id: "european-humanities-pc-6", name: "European Humanities", scopeId: "European Humanities" };
  const plans = [humanitiesPlan, sciencePlan];
  assert.equal(courseCategoryPlan(plans, courseCategoryId(scienceStampedAsHumanities, categories))?.scopeId, "Science");
  assert.notEqual(courseCategoryPlan(plans, courseCategoryId(scienceStampedAsHumanities, categories))?.scopeId, "European Humanities");
  assert.equal(courseCategoryPlan(plans, courseCategoryId(humanitiesStampedAsScience, categories))?.scopeId, "European Humanities");
  assert.equal(courseCategoryPlan(plans, courseCategoryId(uncategorised, categories)), undefined);
  assert.equal(courseCategoryPlan(plans, ""), undefined);
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
  const store = readFileSync(path.join(root, "services/productStore.ts"), "utf8");
  assert.doesNotMatch(store, /input\.category && \[[^\]]+\]\.includes\(input\.category\) \? input\.category : "European Humanities"/);
  assert.doesNotMatch(store, /course\.category \|\|= "European Humanities"/);
});
