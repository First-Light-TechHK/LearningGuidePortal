/**
 * COPY ME. Teaching material only. Scaffold a real file, then paste.
 *   npm run data:migration:new -- add_stoicism_impressions_drill
 */
import type { ProductCourse, ProductLesson } from "../../../services/productStore";
import type { MigrationOrm } from "../../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "../types";

export const id = "091_example_add_lesson_to_course";
export const description = "Add one private drill lesson to an existing Stoicism section.";
export const touches = ["courses"] as const;

const COURSE_ID = "stoicism";
const SECTION_ID = "stoic-foundations";
const LESSON_ID = "daily-impressions-drill";

const lesson: ProductLesson = {
  id: LESSON_ID,
  title: "Daily Impressions Drill",
  durationMinutes: 12,
  isPublic: false,
  body: "Notice one impression today and write the judgement you added to it.",
};

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  const course = courses.findById(COURSE_ID);
  if (!course) return [{ action: "skip", kind: "course", id: COURSE_ID, reason: "missing" }];
  if (course.sections.some((section) => section.lessons.some((item) => item.id === LESSON_ID))) {
    return [{ action: "skip", kind: "lesson", id: LESSON_ID, reason: "exists" }];
  }
  const section = course.sections.find((item) => item.id === SECTION_ID);
  if (!section) return [{ action: "skip", kind: "section", id: SECTION_ID, reason: "missing" }];
  courses.update(COURSE_ID, {
    updatedAt: ctx.now,
    sections: course.sections.map((item) => (
      item.id === SECTION_ID ? { ...item, lessons: [...item.lessons, lesson] } : item
    )),
  });
  return [{ action: "update", kind: "lesson", id: LESSON_ID }];
}
