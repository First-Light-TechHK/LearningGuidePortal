import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { getMessages } from "../../lib/i18n/messages";
import { defaultPortalContent } from "../../lib/portalContent";
import {
  catalogueFilterState,
  courseBreadcrumb,
  courseCardCategoryLine,
  courseCategoryMembership,
  courseTrackChip,
  listedPricingCourseTitles,
  myLearningMetaLine,
  pricingCourseGroup,
  publicLessonRecommendationCategory,
} from "../../lib/courseDetailPresentation";
import type { Locale } from "../../lib/i18n/config";

// UC-PORTAL-CATEGORY: breadcrumbs and the category surfaces that sit beside them.
// Each case calls the builder the page imports. Visible text and href come from that call.

const categories = defaultPortalContent.categories;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const science = {
  id: "biology-course",
  title: "Biology",
  category: "Science" as const,
  categoryId: "science",
  subjectId: "biology",
};
const humanities = {
  id: "horace",
  title: "Quintus Horatius Flaccus",
  category: "European Humanities" as const,
  categoryId: "european-humanities",
  subjectId: "poetry",
};
const chinese = {
  id: "classics",
  title: "Chinese Classics",
  category: "Chinese Humanities" as const,
  categoryId: "chinese-humanities",
  subjectId: "classics",
};
const stampedScience = {
  id: "biology-course",
  title: "Biology",
  category: "European Humanities" as const,
  categoryId: "science",
  subjectId: "biology",
};
const missing = { id: "untitled", title: "Untitled", category: null, categoryId: null, subjectId: null };
const poetryOnly = { id: "poetry-course", title: "Odes", category: null, categoryId: null, subjectId: "poetry" };
const biologyOnly = { id: "bio-only", title: "Cells", category: null, categoryId: null, subjectId: "biology" };

const poetryCatalogue = [
  { id: "european-humanities", name: "European Humanities", parentId: null },
  { id: "poetry", name: "Poetry", parentId: "european-humanities" },
];
const biologyCatalogue = [
  { id: "science", name: "Science", parentId: null },
  { id: "biology", name: "Biology", parentId: "science" },
];
const catalogueNameSaysHumanities = [
  { id: "Science", name: "European Humanities", parentId: null },
  { id: "biology", name: "Biology", parentId: "Science" },
];
const catalogueNameSaysScience = [
  { id: "european-humanities", name: "Science", parentId: null },
  { id: "biology", name: "Biology", parentId: "science" },
];

const expectedCategory = {
  Science: { "en-GB": "Science", "zh-CN": "科学", hrefId: "Science" },
  "European Humanities": { "en-GB": "European Humanities", "zh-CN": "欧洲人文", hrefId: "European Humanities" },
  "Chinese Humanities": { "en-GB": "Chinese Humanities", "zh-CN": "中国人文", hrefId: "Chinese Humanities" },
} as const;

type SurfaceCourse = {
  id: string;
  title: string;
  category?: string | null;
  categoryId?: string | null;
  subjectId?: string | null;
};

function crumbsFor(course: SurfaceCourse, locale: Locale, catalogue: readonly { id: string; name: string; parentId?: string | null }[] = []) {
  const messages = getMessages(locale);
  return courseBreadcrumb({
    locale,
    homeLabel: messages.courseDetailDesign.home,
    coursesLabel: messages.portal.navigation.courses,
    courseInfoLabel: messages.courseDetailDesign.courseInfo,
    course,
    categories,
    catalogue,
  });
}

function categoryCrumb(course: SurfaceCourse, locale: Locale, catalogue: readonly { id: string; name: string; parentId?: string | null }[] = []) {
  return crumbsFor(course, locale, catalogue).find((crumb) => crumb.href?.includes("?category=")) ?? null;
}

function metaLine(course: SurfaceCourse, locale: Locale, catalogue: readonly { id: string; name: string; parentId?: string | null }[] = []) {
  const messages = getMessages(locale);
  return myLearningMetaLine({
    categoryId: courseCategoryMembership(course, catalogue),
    categories,
    locale,
    lessonCount: 4,
    lessonsWord: messages.learning.lessons.toLowerCase(),
    stateLabel: messages.learning.inProgress,
  });
}

test("UC-PORTAL-CATEGORY functional: stored categoryId is the breadcrumb label and portal category href", () => {
  const page = readFileSync(path.join(root, "app/[locale]/portal/courses/[slug]/page.tsx"), "utf8");
  assert.match(page, /import\s*\{[^}]*\bcourseBreadcrumb\b[^}]*\}\s*from\s*"@\/lib\/courseDetailPresentation"/);
  assert.match(page, /\bcourseBreadcrumb\(/);

  for (const locale of ["en-GB", "zh-CN"] as const) {
    const messages = getMessages(locale);
    for (const [course, id] of [[science, "Science"], [humanities, "European Humanities"], [chinese, "Chinese Humanities"]] as const) {
      const expected = expectedCategory[id];
      const list = crumbsFor(course, locale);
      assert.deepEqual(list.map((crumb) => crumb.label), [
        messages.courseDetailDesign.home,
        messages.portal.navigation.courses,
        expected[locale],
        messages.courseDetailDesign.courseInfo,
      ]);
      assert.equal(list[0].href, `/${locale}/portal`);
      assert.equal(list[1].href, `/${locale}/portal/courses`);
      assert.equal(list[2].href, `/${locale}/portal/courses?category=${encodeURIComponent(expected.hrefId)}`);
      assert.equal(list[2].current, false);
      assert.equal(list[3].href, null);
      assert.equal(list[3].current, true);
      const chip = courseTrackChip(course, categories, locale);
      assert.deepEqual(chip, { categoryId: expected.hrefId, label: expected[locale] });
    }
    const scienceCrumbs = crumbsFor(science, locale);
    assert.equal(scienceCrumbs.some((crumb) => crumb.label.includes("欧洲人文") || crumb.label.includes("European Humanities")), false);
    const humanitiesCrumbs = crumbsFor(humanities, locale);
    assert.equal(humanitiesCrumbs.some((crumb) => crumb.label.includes("科学") || crumb.label === "Science"), false);
  }
});

test("UC-PORTAL-CATEGORY functional: catalogue filter, cards, My Learning, recommendations and pricing follow categoryId", () => {
  const cataloguePage = readFileSync(path.join(root, "app/[locale]/portal/courses/page.tsx"), "utf8");
  const homePage = readFileSync(path.join(root, "app/[locale]/portal/page.tsx"), "utf8");
  const learningPage = readFileSync(path.join(root, "app/[locale]/account/my-learning/page.tsx"), "utf8");
  const lessonPage = readFileSync(path.join(root, "app/[locale]/portal/courses/[slug]/public-lesson/page.tsx"), "utf8");
  const pricingPage = readFileSync(path.join(root, "app/[locale]/pricing/page.tsx"), "utf8");
  assert.match(cataloguePage, /\bcatalogueFilterState\(/);
  assert.match(cataloguePage, /\bcourseCardCategoryLine\(/);
  assert.match(homePage, /\bcourseCardCategoryLine\(/);
  assert.match(learningPage, /\bmyLearningMetaLine\(/);
  assert.match(lessonPage, /\bpublicLessonRecommendationCategory\(/);
  assert.match(pricingPage, /\bpricingCourseGroup\(/);

  for (const locale of ["en-GB", "zh-CN"] as const) {
    const messages = getMessages(locale);
    const filter = catalogueFilterState({
      requestedCategory: "Science",
      courses: [
        { ...science, status: "published" },
        { ...humanities, status: "draft" },
        { ...chinese, status: "draft" },
      ],
      categories,
      locale,
      allLabel: messages.portal.allCategories,
    });
    assert.deepEqual(filter.visible.map((course) => course.id), ["biology-course"]);
    assert.equal(filter.visible.some((course) => course.id === humanities.id), false);
    assert.deepEqual(filter.chips.map((chip) => chip.id), ["All", "Science"]);
    assert.equal(filter.chips.some((chip) => chip.id === "European Humanities"), false);
    assert.equal(filter.chips.some((chip) => chip.id === "Chinese Humanities"), false);
    const active = filter.chips.find((chip) => chip.active);
    assert.equal(active?.id, "Science");
    assert.equal(active?.label, expectedCategory.Science[locale]);

    assert.equal(courseCardCategoryLine(science, categories, locale), expectedCategory.Science[locale]);
    assert.equal(courseCardCategoryLine(humanities, categories, locale), expectedCategory["European Humanities"][locale]);
    assert.equal(publicLessonRecommendationCategory(science, categories, locale), expectedCategory.Science[locale]);
    assert.equal(metaLine(science, locale), `${expectedCategory.Science[locale]} · 4 ${messages.learning.lessons.toLowerCase()} · ${messages.learning.inProgress}`);
    assert.equal(pricingCourseGroup(science, categories), "Science");
    assert.deepEqual(listedPricingCourseTitles(
      [science, humanities].map((course) => ({ category: pricingCourseGroup(course, categories), title: course.title })),
      "Science",
    ), ["Biology"]);
    assert.deepEqual(listedPricingCourseTitles(
      [science, humanities].map((course) => ({ category: pricingCourseGroup(course, categories), title: course.title })),
      "European Humanities",
    ), ["Quintus Horatius Flaccus"]);
  }
});

test("UC-PORTAL-CATEGORY negative: legacy field or catalogue name for the other category does not change the surface", () => {
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const crumb = categoryCrumb(stampedScience, locale, catalogueNameSaysHumanities);
    assert.equal(crumb?.label, expectedCategory.Science[locale]);
    assert.equal(crumb?.href, `/${locale}/portal/courses?category=Science`);
    assert.equal(crumb?.label.includes("人文") || crumb?.label.includes("Humanities"), false);
    assert.deepEqual(courseTrackChip(stampedScience, categories, locale, catalogueNameSaysHumanities), {
      categoryId: "Science",
      label: expectedCategory.Science[locale],
    });

    const namedScience = { ...humanities, category: "European Humanities" as const, categoryId: "category_academic", subjectId: "biology" };
    const resolvedCatalogue = [
      { id: "category_academic", name: "Science", parentId: null },
      { id: "biology", name: "Biology", parentId: "category_academic" },
    ];
    const opaqueCrumb = categoryCrumb(namedScience, locale, resolvedCatalogue);
    assert.equal(opaqueCrumb?.label, expectedCategory["European Humanities"][locale]);
    assert.equal(opaqueCrumb?.href, `/${locale}/portal/courses?category=${encodeURIComponent("European Humanities")}`);
    const opaqueLabel = opaqueCrumb?.label ?? "";
    assert.equal(opaqueLabel.includes("科学"), false);
    assert.equal(opaqueLabel.includes("Science"), false);
    assert.deepEqual(courseTrackChip(namedScience, categories, locale, resolvedCatalogue), {
      categoryId: "European Humanities",
      label: expectedCategory["European Humanities"][locale],
    });
    assert.equal(courseCardCategoryLine(namedScience, categories, locale, resolvedCatalogue), expectedCategory["European Humanities"][locale]);
    assert.equal(publicLessonRecommendationCategory(namedScience, categories, locale, resolvedCatalogue), expectedCategory["European Humanities"][locale]);
    assert.equal(metaLine(namedScience, locale, resolvedCatalogue).startsWith(expectedCategory["European Humanities"][locale]), true);
    assert.equal(pricingCourseGroup(namedScience, categories, resolvedCatalogue), "European Humanities");
    const academicChild = {
      id: "cells",
      title: "Cells",
      category: "European Humanities" as const,
      categoryId: "category_biology",
      subjectId: "biology",
    };
    const childCatalogue = [
      { id: "science", name: "European Humanities", parentId: null },
      { id: "category_biology", name: "Biology", parentId: "science" },
    ];
    assert.equal(categoryCrumb(academicChild, locale, childCatalogue)?.label, expectedCategory.Science[locale]);
    assert.equal(categoryCrumb(academicChild, locale, childCatalogue)?.href, `/${locale}/portal/courses?category=Science`);
    assert.equal(pricingCourseGroup(academicChild, categories, childCatalogue), "Science");

    const humanitiesKept = { ...humanities, category: "Science" as const, subjectId: "biology" };
    const crumbHumanities = categoryCrumb(humanitiesKept, locale, catalogueNameSaysScience);
    assert.equal(crumbHumanities?.label, expectedCategory["European Humanities"][locale]);
    assert.equal(crumbHumanities?.href, `/${locale}/portal/courses?category=${encodeURIComponent("European Humanities")}`);
    const humanitiesLabel = crumbHumanities?.label ?? "";
    assert.equal(humanitiesLabel.includes("科学"), false);
    assert.equal(humanitiesLabel.includes("Science"), false);

    const filter = catalogueFilterState({
      requestedCategory: "Science",
      courses: [
        { ...stampedScience, status: "published" },
        { ...humanities, status: "published" },
      ],
      categories,
      catalogue: catalogueNameSaysHumanities,
      locale,
      allLabel: getMessages(locale).portal.allCategories,
    });
    assert.deepEqual(filter.visible.map((course) => course.id), [stampedScience.id]);
    assert.equal(filter.chips.find((chip) => chip.active)?.id, "Science");
    assert.equal(filter.chips.some((chip) => chip.id === "Chinese Humanities"), false);
    const otherFilter = catalogueFilterState({
      requestedCategory: "European Humanities",
      courses: [{ ...stampedScience, status: "published" }],
      categories,
      catalogue: catalogueNameSaysHumanities,
      locale,
      allLabel: getMessages(locale).portal.allCategories,
    });
    assert.deepEqual(otherFilter.visible, []);
    assert.deepEqual(otherFilter.chips.map((chip) => chip.id), ["All", "Science"]);
    assert.equal(otherFilter.chips.some((chip) => chip.id === "European Humanities"), false);
    assert.equal(otherFilter.chips.some((chip) => chip.id === "Chinese Humanities"), false);

    assert.equal(courseCardCategoryLine(stampedScience, categories, locale, catalogueNameSaysHumanities), expectedCategory.Science[locale]);
    assert.equal(publicLessonRecommendationCategory(stampedScience, categories, locale, catalogueNameSaysHumanities), expectedCategory.Science[locale]);
    assert.equal(metaLine(stampedScience, locale, catalogueNameSaysHumanities).startsWith(expectedCategory.Science[locale]), true);
    assert.equal(metaLine(stampedScience, locale, catalogueNameSaysHumanities).includes("人文"), false);
    assert.equal(pricingCourseGroup(stampedScience, categories, catalogueNameSaysHumanities), "Science");
    assert.deepEqual(listedPricingCourseTitles(
      [{ category: pricingCourseGroup(stampedScience, categories, catalogueNameSaysHumanities), title: stampedScience.title }],
      "European Humanities",
    ), []);
  }
});

test("UC-PORTAL-CATEGORY edge: missing category omits the crumb, and a subject does not replace it", () => {
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const messages = getMessages(locale);
    for (const [course, catalogue] of [
      [missing, []],
    ] as const) {
      const list = crumbsFor(course, locale, catalogue);
      assert.deepEqual(list.map((crumb) => crumb.label), [
        messages.courseDetailDesign.home,
        messages.portal.navigation.courses,
        messages.courseDetailDesign.courseInfo,
      ]);
      assert.equal(list.some((crumb) => crumb.href?.includes("?category=")), false);
      assert.equal(list.some((crumb) => /科学|欧洲人文|中国人文|Science|Humanities/.test(crumb.label)), false);
      assert.equal(courseTrackChip(course, categories, locale, catalogue), null);
      assert.equal(courseCardCategoryLine(course, categories, locale, catalogue), "");
      assert.equal(publicLessonRecommendationCategory(course, categories, locale, catalogue), "");
      assert.equal(metaLine(course, locale, catalogue), `4 ${messages.learning.lessons.toLowerCase()} · ${messages.learning.inProgress}`);
      assert.equal(pricingCourseGroup(course, categories, catalogue), "");
      for (const requested of ["Science", "European Humanities", "Chinese Humanities"] as const) {
        const filter = catalogueFilterState({
          requestedCategory: requested,
          courses: [course],
          categories,
          catalogue,
          locale,
          allLabel: messages.portal.allCategories,
        });
        assert.deepEqual(filter.visible, []);
        assert.equal(filter.chips.some((chip) => chip.id === requested), false);
        assert.equal(filter.chips.find((chip) => chip.id === "All")?.active, false);
      }
    }

    const publishedScience = { ...science, status: "published" as const };
    const draftHumanities = { ...humanities, status: "draft" as const };
    const occupied = catalogueFilterState({
      requestedCategory: "All",
      courses: [publishedScience, draftHumanities],
      categories,
      locale,
      allLabel: messages.portal.allCategories,
    });
    assert.deepEqual(occupied.chips.map((chip) => chip.id), ["All", "Science"]);
    assert.equal(occupied.chips.some((chip) => chip.id === "European Humanities"), false);
    assert.equal(occupied.chips.some((chip) => chip.id === "Chinese Humanities"), false);
    assert.deepEqual(occupied.visible.map((course) => course.id), [publishedScience.id]);
    const emptyCategory = catalogueFilterState({
      requestedCategory: "Chinese Humanities",
      courses: [publishedScience],
      categories,
      locale,
      allLabel: messages.portal.allCategories,
    });
    assert.equal(emptyCategory.chips.some((chip) => chip.id === "Chinese Humanities"), false);
    assert.deepEqual(emptyCategory.visible, []);

    assert.equal(categoryCrumb(poetryOnly, locale, poetryCatalogue)?.label, expectedCategory["European Humanities"][locale]);
    assert.notEqual(categoryCrumb(poetryOnly, locale, poetryCatalogue)?.label, "Poetry");
    assert.equal(categoryCrumb(biologyOnly, locale, biologyCatalogue)?.label, expectedCategory.Science[locale]);
    assert.notEqual(categoryCrumb(biologyOnly, locale, biologyCatalogue)?.label, "Biology");
    assert.equal(courseCardCategoryLine(poetryOnly, categories, locale, poetryCatalogue), expectedCategory["European Humanities"][locale]);
    assert.equal(pricingCourseGroup(biologyOnly, categories, biologyCatalogue), "Science");

    const humanitiesWithBiology = { ...humanities, subjectId: "biology" };
    const crumb = categoryCrumb(humanitiesWithBiology, locale, biologyCatalogue);
    assert.equal(crumb?.label, expectedCategory["European Humanities"][locale]);
    assert.equal(crumb?.href, `/${locale}/portal/courses?category=${encodeURIComponent("European Humanities")}`);
    assert.equal(courseCardCategoryLine(humanitiesWithBiology, categories, locale, biologyCatalogue), expectedCategory["European Humanities"][locale]);
    const scienceWithPoetry = { ...science, subjectId: "poetry" };
    assert.equal(categoryCrumb(scienceWithPoetry, locale, poetryCatalogue)?.label, expectedCategory.Science[locale]);
    assert.deepEqual(listedPricingCourseTitles(
      [{ category: pricingCourseGroup(humanitiesWithBiology, categories, biologyCatalogue), title: humanitiesWithBiology.title }],
      "Science",
    ), []);
  }
});
