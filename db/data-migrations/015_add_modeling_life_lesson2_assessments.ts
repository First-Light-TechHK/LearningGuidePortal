import type { LessonAssessments } from "../../contracts/lesson-resources";
import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "015_add_modeling_life_lesson2_assessments";
export const description = "Add the supplied eight Knowledge questions and one Application question to Modeling life Lesson 02.";
export const touches = ["courses"] as const;

// Source: lesson 2-tests.xlsx; knowledge test!C2:D9 and application test!B2:C2.
// Workbook SHA-256: 4960a37733a2d4bf6a5bca5433b2e2fbf343f9e553f082f93d55c1a1bf85e037
// Content stays in the supplied English; UI locale does not translate authored questions.
const sourceAssessments: LessonAssessments = {
  "knowledge": [
    {
      "id": "modeling-life-l2-knowledge-1",
      "prompt": "What is a pitchfork bifurcation?",
      "referenceAnswer": "A pitchfork bifurcation occurs when a change in a system's parameter causes an equilibrium point to change stability and two additional equilibrium points to emerge or disappear. The resulting bifurcation diagram resembles a pitchfork."
    },
    {
      "id": "modeling-life-l2-knowledge-2",
      "prompt": "How can a pitchfork bifurcation be used to model public opinion?",
      "referenceAnswer": "It can describe how a population moves from a neutral or balanced opinion towards two alternative positions. As a parameter changes, a previously stable neutral state may become unstable, allowing two stable opposing opinions to emerge."
    },
    {
      "id": "modeling-life-l2-knowledge-3",
      "prompt": "What is the bifurcation parameter in a model of public opinion?",
      "referenceAnswer": "The bifurcation parameter is a variable that controls the behaviour of the system. In a public opinion model, it might represent the strength of social influence or the tendency towards opinion polarisation. Changing this parameter can alter the number and stability of equilibrium points."
    },
    {
      "id": "modeling-life-l2-knowledge-4",
      "prompt": "What happens to the equilibrium points in a supercritical pitchfork bifurcation?",
      "referenceAnswer": "Before the critical parameter value, there is one stable equilibrium point. At the critical value, a bifurcation occurs. Beyond this point, the original equilibrium becomes unstable and two new stable equilibria appear."
    },
    {
      "id": "modeling-life-l2-knowledge-5",
      "prompt": "What is a transcritical bifurcation?",
      "referenceAnswer": "A transcritical bifurcation occurs when two equilibrium branches intersect and exchange stability as a parameter passes through a critical value."
    },
    {
      "id": "modeling-life-l2-knowledge-6",
      "prompt": "How does a transcritical bifurcation differ from a pitchfork bifurcation?",
      "referenceAnswer": "In a pitchfork bifurcation, two additional equilibrium branches emerge or disappear at a critical point. In a transcritical bifurcation, two existing equilibrium branches cross and exchange stability."
    },
    {
      "id": "modeling-life-l2-knowledge-7",
      "prompt": "How can we determine whether an equilibrium point is stable or unstable?",
      "referenceAnswer": "For a one-dimensional differential equation, we examine the derivative of the function describing the system at the equilibrium point. A negative derivative indicates local stability, while a positive derivative indicates instability. A zero derivative requires further analysis."
    },
    {
      "id": "modeling-life-l2-knowledge-8",
      "prompt": "Why are bifurcations important in understanding dynamic systems?",
      "referenceAnswer": "Bifurcations help us understand how small changes in a system's parameters can produce qualitative changes in its behaviour, such as changes in the number or stability of equilibria. They are useful for studying phenomena in biology, physics, economics and social systems."
    }
  ],
  "application": {
    "id": "modeling-life-l2-application-1",
    "paragraphs": [
      "Suppose a small community is discussing a proposal to build a new public park.",
      "Initially, most residents have neutral opinions. Some support the proposal, while others oppose it, but the community generally remains balanced.",
      "As public discussions become more frequent, residents are increasingly influenced by the views of their neighbours.",
      "Eventually, two distinct groups emerge: one strongly supports the park, while the other strongly opposes it. The previously neutral position becomes less stable.",
      "Question:",
      "How can a pitchfork bifurcation explain this change in public opinion? What happens to the stability of the neutral position as social influence increases?"
    ],
    "reference": [
      "This situation can be explained using a supercritical pitchfork bifurcation.",
      "Step 1: Identify the initial equilibrium",
      "Initially, the community has a stable neutral position. Small changes in individual opinions do not significantly affect the overall balance, and public opinion tends to return towards neutrality.",
      "Step 2: Identify the changing parameter",
      "The strength of social influence acts as the bifurcation parameter. As residents interact more frequently and become more influenced by their neighbours, this parameter increases.",
      "Step 3: Explain the bifurcation",
      "When social influence reaches a critical level, the neutral equilibrium loses stability. Two new stable equilibria emerge, representing strong support for and strong opposition to the proposal.",
      "Step 4: Interpret the outcome",
      "The community's overall opinion may move towards either of the two stable positions. Small differences in initial opinions or external influences may determine which position becomes dominant.",
      "Conclusion",
      "A pitchfork bifurcation demonstrates how a gradual increase in social influence can transform a stable, balanced public opinion into two alternative stable states. This illustrates how a relatively small change in a system's conditions can produce a significant change in its behaviour."
    ]
  }
};

export function modelingLifeLesson2Assessments(): LessonAssessments {
  return structuredClone(sourceAssessments);
}

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  const course = courses.findById("modeling-life");
  if (!course) return [{ action: "skip", kind: "course", id: "modeling-life", reason: "missing" }];
  if (course.slug !== "modeling-life") throw new Error(`${id}: course identity conflict.`);
  const lessonId = "modeling-life-lesson-2";
  const lessons = course.sections.flatMap(section => section.lessons).filter(lesson => lesson.id === lessonId);
  if (!lessons.length) return [{ action: "skip", kind: "lesson", id: lessonId, reason: "missing" }];
  if (lessons.length !== 1) throw new Error(`${id}: ambiguous Lesson 02 identity.`);
  const existing = lessons[0].assessments;
  const addKnowledge = !existing?.knowledge.length;
  const addApplication = !existing?.application;
  if (!addKnowledge && !addApplication) return [{ action: "skip", kind: "lesson", id: lessonId, reason: "assessments-exist" }];
  const supplied = modelingLifeLesson2Assessments();
  const assessments: LessonAssessments = {
    ...existing,
    knowledge: addKnowledge ? supplied.knowledge : existing!.knowledge,
    application: addApplication ? supplied.application : existing!.application,
  };
  courses.update(course.id, {
    updatedAt: new Date(Math.max(Date.parse(ctx.now), Date.parse(course.updatedAt) + 1)).toISOString(),
    sections: course.sections.map(section => ({
      ...section,
      lessons: section.lessons.map(lesson => lesson.id === lessonId ? { ...lesson, assessments } : lesson),
    })),
  });
  return [{ action: "update", kind: "lesson", id: lessonId, reason: [addKnowledge ? "knowledge:8" : "", addApplication ? "application:1" : ""].filter(Boolean).join(",") }];
}
