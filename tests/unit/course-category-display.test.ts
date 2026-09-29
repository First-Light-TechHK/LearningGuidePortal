import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { CourseLearningOutcomes } from "../../components/portal/CourseLearningOutcomes";
import { courseCategoryDisplay, courseCategoryPlan } from "../../lib/courseDetailPresentation";
import { courseIdentityFrom } from "../../lib/coursePage";
import { defaultPortalContent } from "../../lib/portalContent";
import type { ProductPlan } from "../../services/productStore";
import en from "../../messages/en-GB.json";
import zh from "../../messages/zh-CN.json";

const categories = defaultPortalContent.categories;
const locales = ["en-GB", "zh-CN"] as const;
const labels = {
  Science: { "en-GB": "Science", "zh-CN": "科学" },
  "European Humanities": { "en-GB": "European Humanities", "zh-CN": "欧洲人文" },
  "Chinese Humanities": { "en-GB": "Chinese Humanities", "zh-CN": "中国人文" },
} as const;
const sharedBiology = [en.courseDetailDesign.outcomes[0], zh.courseDetailDesign.outcomes[0]];

const sciencePlan: ProductPlan = {
  id: "science-pc-6",
  name: "Science",
  courseId: "*",
  scope: "category",
  scopeId: "Science",
  device: "pc",
  termMonths: 6,
  amountMinor: 4900,
  currency: "usd",
  available: true,
};
const humanitiesPlan: ProductPlan = {
  ...sciencePlan,
  id: "european-humanities-pc-6",
  name: "European Humanities",
  scopeId: "European Humanities",
};
const plans = [humanitiesPlan, sciencePlan];

function shown(
  course: Parameters<typeof courseCategoryDisplay>[0],
  locale: (typeof locales)[number],
  catalogue: Parameters<typeof courseCategoryDisplay>[3] = [],
) {
  return courseCategoryDisplay(course, categories, locale, catalogue);
}

test("Functional: categoryId science and european-humanities project onto breadcrumb, filter, card, learning, recommendation and pricing", () => {
  assert.equal(sharedBiology[0], "Model real biological systems mathematically");
  assert.equal(sharedBiology[1], "用数学建模真实的生物系统");
  const science = { title: "Biology", categoryId: "science", subjectId: "biology" };
  const humanities = { title: "Quintus Horatius Flaccus", categoryId: "european-humanities", subjectId: "poetry" };

  for (const locale of locales) {
    const scienceDisplay = shown(science, locale);
    const humanitiesDisplay = shown(humanities, locale);

    assert.equal(scienceDisplay.membership, "Science");
    assert.equal(humanitiesDisplay.membership, "European Humanities");
    assert.deepEqual(scienceDisplay.crumb, { id: "Science", label: labels.Science[locale] });
    assert.deepEqual(humanitiesDisplay.crumb, { id: "European Humanities", label: labels["European Humanities"][locale] });
    assert.equal(scienceDisplay.crumb?.id, "Science");
    assert.equal(humanitiesDisplay.crumb?.id, "European Humanities");

    assert.equal(scienceDisplay.matchesFilter("Science"), true);
    assert.equal(scienceDisplay.matchesFilter("European Humanities"), false);
    assert.equal(humanitiesDisplay.matchesFilter("European Humanities"), true);
    assert.equal(humanitiesDisplay.matchesFilter("Science"), false);

    assert.equal(scienceDisplay.cardLabel, labels.Science[locale]);
    assert.equal(humanitiesDisplay.cardLabel, labels["European Humanities"][locale]);
    assert.equal(scienceDisplay.learningLabel, labels.Science[locale]);
    assert.equal(humanitiesDisplay.learningLabel, labels["European Humanities"][locale]);
    assert.equal(scienceDisplay.recommendationLabel, labels.Science[locale]);
    assert.equal(humanitiesDisplay.recommendationLabel, labels["European Humanities"][locale]);

    assert.equal(scienceDisplay.pricingCategoryId, "Science");
    assert.equal(humanitiesDisplay.pricingCategoryId, "European Humanities");
    assert.equal(courseCategoryPlan(plans, scienceDisplay.pricingCategoryId)?.id, sciencePlan.id);
    assert.equal(courseCategoryPlan(plans, humanitiesDisplay.pricingCategoryId)?.id, humanitiesPlan.id);
    assert.notEqual(courseCategoryPlan(plans, scienceDisplay.pricingCategoryId)?.scopeId, "European Humanities");

    assert.equal(courseIdentityFrom({ ...science, status: "published", sections: [] }).track, "Science");
    assert.equal(courseIdentityFrom({ ...humanities, status: "published", sections: [] }).track, "European Humanities");
  }
});

test("Negative: legacy category and catalogue name do not move membership off categoryId, and a humanities course does not show shared biology outcomes", () => {
  const catalogue = [
    { id: "science", name: "European Humanities", parentId: null },
    { id: "biology", name: "Biology", parentId: "science" },
    { id: "european-humanities", name: "Science", parentId: null },
    { id: "poetry", name: "Poetry", parentId: "european-humanities" },
  ];
  const science = {
    title: "Biology",
    category: "European Humanities" as const,
    categoryId: "science",
    subjectId: "biology",
    outcomes: ["Model real biological systems mathematically"],
  };
  const humanities = {
    title: "Quintus Horatius Flaccus",
    category: "Science" as const,
    categoryId: "european-humanities",
    subjectId: "poetry",
  };

  for (const locale of locales) {
    const scienceDisplay = shown(science, locale, catalogue);
    const humanitiesDisplay = shown(humanities, locale, catalogue);

    assert.equal(scienceDisplay.membership, "Science");
    assert.equal(humanitiesDisplay.membership, "European Humanities");
    assert.deepEqual(scienceDisplay.crumb, { id: "Science", label: labels.Science[locale] });
    assert.deepEqual(humanitiesDisplay.crumb, { id: "European Humanities", label: labels["European Humanities"][locale] });
    assert.notEqual(scienceDisplay.crumb?.label, "European Humanities");
    assert.notEqual(scienceDisplay.crumb?.label, "欧洲人文");
    assert.notEqual(scienceDisplay.crumb?.label, "Biology");
    assert.notEqual(humanitiesDisplay.crumb?.label, "Science");
    assert.notEqual(humanitiesDisplay.crumb?.label, "科学");
    assert.notEqual(humanitiesDisplay.crumb?.label, "Poetry");

    assert.equal(scienceDisplay.matchesFilter("Science"), true);
    assert.equal(scienceDisplay.matchesFilter("European Humanities"), false);
    assert.equal(humanitiesDisplay.matchesFilter("European Humanities"), true);
    assert.equal(humanitiesDisplay.matchesFilter("Science"), false);
    assert.equal(scienceDisplay.cardLabel, labels.Science[locale]);
    assert.equal(humanitiesDisplay.cardLabel, labels["European Humanities"][locale]);
    assert.equal(scienceDisplay.learningLabel, labels.Science[locale]);
    assert.equal(humanitiesDisplay.learningLabel, labels["European Humanities"][locale]);
    assert.equal(scienceDisplay.recommendationLabel, labels.Science[locale]);
    assert.equal(humanitiesDisplay.recommendationLabel, labels["European Humanities"][locale]);
    assert.equal(scienceDisplay.pricingCategoryId, "Science");
    assert.equal(courseCategoryPlan(plans, scienceDisplay.pricingCategoryId)?.id, sciencePlan.id);
    assert.equal(courseCategoryPlan(plans, humanitiesDisplay.pricingCategoryId)?.id, humanitiesPlan.id);

    assert.equal(humanitiesDisplay.outcomes.includes(sharedBiology[0]), false);
    assert.equal(humanitiesDisplay.outcomes.includes(sharedBiology[1]), false);
    assert.deepEqual(humanitiesDisplay.outcomes, []);
  }

  assert.deepEqual(shown(science, "en-GB", catalogue).outcomes, ["Model real biological systems mathematically"]);
  const stored = shown({ categoryId: "science", outcomes: [`  ${sharedBiology[0]}  `, "", sharedBiology[1], sharedBiology[0]] }, "zh-CN", catalogue);
  assert.deepEqual(stored.outcomes, [sharedBiology[0], sharedBiology[1]]);
  const shownOutcomes = renderToStaticMarkup(createElement(CourseLearningOutcomes, {
    title: zh.courseDetailDesign.outcomesTitle,
    outcomes: stored.outcomes,
  }));
  assert.match(shownOutcomes, new RegExp(sharedBiology[0]));
  assert.match(shownOutcomes, new RegExp(sharedBiology[1]));
  const hiddenOutcomes = renderToStaticMarkup(createElement(CourseLearningOutcomes, {
    title: en.courseDetailDesign.outcomesTitle,
    outcomes: shown(humanities, "en-GB", catalogue).outcomes,
  }));
  assert.equal(hiddenOutcomes, "");
  const catalogueOutcomes = [
    { id: "poetry", name: "Poetry", parentId: "european-humanities", outcomes: [sharedBiology[0]] },
    { id: "european-humanities", name: "Science", parentId: null, outcomes: [sharedBiology[1]] },
  ];
  assert.deepEqual(shown({ categoryId: "european-humanities", subjectId: "poetry" }, "en-GB", catalogueOutcomes).outcomes, []);
});

test("Edge: no category leaves every surface empty, and a subject does not replace the category crumb", () => {
  const catalogue = [
    { id: "science", name: "Science", parentId: null },
    { id: "biology", name: "Biology", parentId: "science" },
    { id: "poetry", name: "Poetry", parentId: null },
  ];
  const uncategorised = { title: "Untitled", category: null, categoryId: null, subjectId: null };
  const subjectOnly = { title: "Untitled", category: null, categoryId: null, subjectId: "poetry" };
  const biologyUnderScience = {
    title: "Biology",
    category: null,
    categoryId: "science",
    subjectId: "biology",
  };
  const namedButUnmatched = {
    title: "Biology",
    category: "European Humanities" as const,
    categoryId: "cat-science",
    subjectId: "biology",
  };
  const legacySlugOnly = { title: "Biology", category: "science", categoryId: null, subjectId: null };

  for (const locale of locales) {
    for (const course of [uncategorised, subjectOnly, namedButUnmatched, legacySlugOnly]) {
      const display = shown(course, locale, catalogue);
      assert.equal(display.membership, "");
      assert.equal(display.crumb, null);
      assert.equal(display.cardLabel, "");
      assert.equal(display.learningLabel, "");
      assert.equal(display.recommendationLabel, "");
      assert.equal(display.pricingCategoryId, "");
      assert.equal(display.matchesFilter("Science"), false);
      assert.equal(display.matchesFilter("European Humanities"), false);
      assert.equal(display.matchesFilter("Chinese Humanities"), false);
      assert.equal(courseCategoryPlan(plans, display.pricingCategoryId), undefined);
      assert.deepEqual(display.outcomes, []);
    }

    const underScience = shown(biologyUnderScience, locale, catalogue);
    assert.equal(underScience.membership, "Science");
    assert.deepEqual(underScience.crumb, { id: "Science", label: labels.Science[locale] });
    assert.notEqual(underScience.crumb?.label, "Biology");
    assert.notEqual(underScience.cardLabel, "Biology");
    assert.equal(courseIdentityFrom({ ...uncategorised, status: "published", sections: [] }).track, "");
    assert.equal(courseIdentityFrom({ ...biologyUnderScience, status: "published", sections: [] }).track, "Science");
  }

  const bySubjectParent = shown(
    { category: "European Humanities", categoryId: null, subjectId: "biology" },
    "en-GB",
    catalogue,
  );
  assert.equal(bySubjectParent.membership, "Science");
  assert.deepEqual(bySubjectParent.crumb, { id: "Science", label: "Science" });
  assert.notEqual(bySubjectParent.crumb?.label, "Biology");
  assert.notEqual(bySubjectParent.crumb?.label, "European Humanities");

  const exactLegacy = shown({ category: "European Humanities", categoryId: "", subjectId: "" }, "zh-CN");
  assert.equal(exactLegacy.membership, "European Humanities");
  assert.deepEqual(exactLegacy.crumb, { id: "European Humanities", label: "欧洲人文" });

  const biologyNamedParent = [
    { id: "science", name: "Biology", parentId: null },
    { id: "biology", name: "Biology", parentId: "science" },
  ];
  const cells = shown({ category: null, categoryId: null, subjectId: "biology" }, "zh-CN", biologyNamedParent);
  assert.equal(cells.membership, "Science");
  assert.deepEqual(cells.crumb, { id: "Science", label: "科学" });
  assert.notEqual(cells.crumb?.label, "Biology");
  assert.equal(cells.cardLabel, "科学");

  const poetryNamedParent = [
    { id: "european-humanities", name: "Poetry", parentId: null },
    { id: "poetry", name: "Poetry", parentId: "european-humanities" },
  ];
  const horace = shown({ category: "Science", categoryId: null, subjectId: "poetry" }, "en-GB", poetryNamedParent);
  assert.equal(horace.membership, "European Humanities");
  assert.deepEqual(horace.crumb, { id: "European Humanities", label: "European Humanities" });
  assert.notEqual(horace.crumb?.label, "Poetry");
  assert.notEqual(horace.crumb?.label, "Science");
  assert.equal(horace.matchesFilter("European Humanities"), true);
  assert.equal(horace.matchesFilter("Science"), false);
});
