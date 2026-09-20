import type { ProductData } from "../../services/productStore";
import type { DataChange, DataMigrationContext } from "./types";

// Copy to 00N_your_name.ts. Do not import persistence/db or S3 from here.
// id must match the filename without .ts

export const id = "00N_your_name";
export const description = "One sentence: what logical row changes.";
export const touches = ["courses"] as const;

export function apply(data: ProductData, ctx: DataMigrationContext): DataChange[] {
  const existing = data.courses.find((course) => course.id === "example");
  if (existing) return [{ action: "skip", kind: "course", id: "example", reason: "exists" }];
  data.courses.push({
    id: "example",
    slug: "example",
    title: "Example",
    description: "Seeded by data migration.",
    category: "European Humanities",
    thumbnailPath: "/portal/course-study.jpg",
    status: "published",
    createdAt: ctx.now,
    updatedAt: ctx.now,
    sections: [{ id: "example-s", title: "One", lessons: [{ id: "example-l", title: "Public", durationMinutes: 10, isPublic: true, body: "Body" }] }],
  });
  return [{ action: "add", kind: "course", id: "example" }];
}

export function plan(ctx: DataMigrationContext) {
  return {
    sql: [
      `-- future relational adapter; ignored by the aggregate runner
-- INSERT INTO courses (id, slug, title) VALUES ('example', 'example', 'Example')
-- WHERE NOT EXISTS (SELECT 1 FROM courses WHERE id = 'example');`,
    ],
    objects: [] as Array<{ key: string; source: string; contentType: string }>,
  };
}
