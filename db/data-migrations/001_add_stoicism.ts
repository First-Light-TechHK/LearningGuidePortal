import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "001_add_stoicism";
export const description = "Add the published Stoicism sibling course so DEV catalogue and trial recommendations have a second course.";
export const touches = ["courses"] as const;

export function stoicismCourse(createdAt: string): ProductCourse {
  return {
    id: "stoicism",
    slug: "stoicism",
    title: "Stoicism",
    description: "A guided introduction to judgement, impression and the Stoic distinction between what is up to us and what is not.",
    category: "European Humanities",
    thumbnailPath: "/portal/course-book.jpg",
    status: "published",
    createdAt,
    updatedAt: createdAt,
    sections: [
      {
        id: "stoic-foundations",
        title: "Foundations",
        lessons: [
          {
            id: "what-is-up-to-us",
            title: "What Is Up to Us",
            durationMinutes: 20,
            isPublic: true,
            body: `Epictetus begins from a practical cut: some things are up to us, and some things are not. Judgement, impulse and desire are treated as ours to train. Body, property, reputation and office are not.

The first public lesson is this cut, not a claim that a Stoic never feels. An impression can arrive uninvited; the work is what we add to it. Calling an event terrible is already a judgement, and that judgement can be examined.

Keep this separate from later popular slogans about “having no emotions”. The course presents the Handbook’s distinction first, then asks what it would mean to withhold assent from an impression that is not yet tested.`,
          },
          {
            id: "impressions-and-assent",
            title: "Impressions and Assent",
            durationMinutes: 18,
            isPublic: false,
            body: `An impression can arrive uninvited. Assent is the move that takes the presentation as true. The Stoic training is to notice the gap and not rush it.

This lesson stays with that pause. It does not replace medical or personal advice, and it does not say every later school agrees with Epictetus.`,
          },
        ],
      },
    ],
  };
}

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  if (courses.find((course) => course.id === "stoicism" || course.slug === "stoicism").length) {
    return [{ action: "skip", kind: "course", id: "stoicism", reason: "exists" }];
  }
  courses.insert(stoicismCourse(ctx.now));
  return [{ action: "add", kind: "course", id: "stoicism" }];
}
