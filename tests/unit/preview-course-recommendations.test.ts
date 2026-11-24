import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProductCourse } from "../../services/productStore";
import { isolate } from "../io/harness";
import { writeProductData } from "./helpers/my-learning";

test("preview recommends published courses from the same category first and fills any remaining slots", async () => {
  const { restore } = await isolate("lg-preview-recommendations-");
  try {
    const { ensureProductData, listPreviewCourseRecommendations } = await import("../../services/productStore");
    const data = await ensureProductData();
    const course = (id: string, fields: Partial<ProductCourse> = {}): ProductCourse => ({
      id, slug: id, title: id, category: "Science", categoryId: "science",
      status: "published", description: "", sections: [], createdAt: "", updatedAt: "",
      ...fields
    });
    const current = course("current");
    const same = course("same");
    const legacy = course("legacy", { categoryId: undefined });
    const other = course("other", { category: "European Humanities", categoryId: "humanities" });
    const sameLabelDifferentId = course("same-label", { categoryId: "different" });
    const draft = course("draft", { status: "draft" });
    const archived = course("archived", { status: "archived" });
    const recommend = async (courses: ProductCourse[], source = current) => {
      await writeProductData({ ...data, courses: [current, draft, archived, ...courses] });
      return (await listPreviewCourseRecommendations(source)).map(item => item.id);
    };

    assert.deepEqual(await recommend([other, same, legacy, course("third-match")]), ["same", "legacy"]);
    assert.deepEqual(await recommend([other, sameLabelDifferentId, same]), ["same", "other"]);
    assert.deepEqual(await recommend([other, sameLabelDifferentId]), ["other", "same-label"]);
    assert.deepEqual(await recommend([other, same], course("current", { categoryId: undefined })), ["same", "other"]);
    assert.deepEqual(await recommend([other, course("uncategorised", { categoryId: undefined, category: undefined })], course("current", { categoryId: undefined, category: undefined })), ["other", "uncategorised"]);
    assert.deepEqual(await recommend([other]), ["other"]);
    assert.deepEqual(await recommend([]), []);
  } finally {
    await restore();
  }
});
