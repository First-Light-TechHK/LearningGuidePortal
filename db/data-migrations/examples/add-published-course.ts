/**
 * COPY ME. This file is teaching material, not a live migration.
 * Do not register it in index.ts. Scaffold a real file with:
 *   npm run data:migration:new -- add_roman_history
 * then paste the exports below and change the ids.
 */
import type { ProductCourse } from "../../../services/productStore";
import type { MigrationOrm } from "../../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "../types";

export const id = "090_example_add_roman_history";
export const description = "Add the published Roman History sibling course.";
export const touches = ["courses"] as const;

export function romanHistoryCourse(createdAt: string): ProductCourse {
  return {
    id: "roman-history",
    slug: "roman-history",
    title: "Roman History",
    description: "A short published course used as the catalogue example in the data-migration guide.",
    category: "European Humanities",
    thumbnailPath: "/portal/course-book.jpg",
    status: "published",
    createdAt,
    updatedAt: createdAt,
    sections: [
      {
        id: "roman-foundations",
        title: "Foundations",
        lessons: [
          {
            id: "what-is-the-republic",
            title: "What Is the Republic",
            durationMinutes: 15,
            isPublic: true,
            body: "A published course needs at least one public lesson so visitors can preview it.",
          },
          {
            id: "from-republic-to-empire",
            title: "From Republic to Empire",
            durationMinutes: 18,
            isPublic: false,
            body: "Later lessons stay private until the learner is entitled.",
          },
        ],
      },
    ],
  };
}

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  if (courses.find((course) => course.id === "roman-history" || course.slug === "roman-history").length) {
    return [{ action: "skip", kind: "course", id: "roman-history", reason: "exists" }];
  }
  courses.insert(romanHistoryCourse(ctx.now));
  return [{ action: "add", kind: "course", id: "roman-history" }];
}
