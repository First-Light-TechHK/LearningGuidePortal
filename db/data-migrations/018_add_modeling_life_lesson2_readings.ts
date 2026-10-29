import type { ExplorationReading } from "../../contracts/exploration";
import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "018_add_modeling_life_lesson2_readings";
export const description = "Copy Modeling life Lesson 1's three readings to Lesson 2, continuing pages 24–31 and lectures 14–18.";
export const touches = ["courses"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses"), course = courses.findById("modeling-life");
  if (!course) return [{ action: "skip", kind: "course", id: "modeling-life", reason: "missing" }];
  if (course.slug !== "modeling-life") throw new Error(`${id}: course identity conflict.`);
  const lessons = course.sections.flatMap(section => section.lessons);
  const targetId = "modeling-life-lesson-2", targets = lessons.filter(lesson => lesson.id === targetId);
  if (!targets.length) return [{ action: "skip", kind: "lesson", id: targetId, reason: "missing" }];
  if (targets.length !== 1) throw new Error(`${id}: ambiguous Lesson 02 identity.`);
  const target = targets[0];
  if (target.exploration?.readings.length) return [{ action: "skip", kind: "lesson", id: targetId, reason: "readings-exist" }];
  const sources = lessons.filter(lesson => lesson.id === "modeling-life-lesson-1");
  if (sources.length !== 1) throw new Error(`${id}: missing or ambiguous Lesson 01 identity.`);
  const readings: ExplorationReading[] = [1, 2, 3].map(number => {
    const matches = sources[0].exploration?.readings.filter(reading => reading.id === `modeling-life-l1-reading-${number}`) || [];
    if (matches.length !== 1) throw new Error(`${id}: missing or ambiguous source reading ${number}.`);
    const reading = matches[0];
    let title = reading.title;
    if (number === 1) {
      if (!/pp\s+16\s*[–-]\s*23(?=\.\s*$)/.test(title)) throw new Error(`${id}: source page range changed.`);
      title = title.replace(/pp\s+16\s*[–-]\s*23(?=\.\s*$)/, "pp 24 – 31");
    } else if (number === 2) {
      if (!/lectures\s+9\s*[–-]\s*13(?=\.\s*$)/.test(title)) throw new Error(`${id}: source lecture range changed.`);
      title = title.replace(/lectures\s+9\s*[–-]\s*13(?=\.\s*$)/, "lectures 14-18");
    }
    return { ...structuredClone(reading), id: `modeling-life-l2-reading-${number}`, title, lessonNumber: "02" };
  });
  courses.update(course.id, {
    updatedAt: new Date(Math.max(Date.parse(ctx.now), Date.parse(course.updatedAt) + 1)).toISOString(),
    sections: course.sections.map(section => ({ ...section, lessons: section.lessons.map(lesson => lesson.id === targetId
      ? { ...lesson, exploration: { ...lesson.exploration, readings, exhibits: lesson.exploration?.exhibits || [] } } : lesson) })),
  });
  return [{ action: "update", kind: "lesson", id: targetId, reason: "readings:3,pages:24-31,lectures:14-18" }];
}
