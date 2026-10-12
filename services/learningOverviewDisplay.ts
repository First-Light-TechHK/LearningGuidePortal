import type { LearningOverviewDisplay, OverviewCourseIdentity } from "@/contracts/learning-overview-display";
import type { ProductCourse } from "@/services/productStore";
import { listPublishedCourses, getLearningOverview } from "@/services/productStore";
import { availableCourseLearningModes } from "@/lib/courseLearningMode";
import { signCourseMediaUrl } from "@/services/persistence/s3";

/** Temporary presentation samples requested for Overview design acceptance.
 * Never persist these percentages or create Study Records/Entitlements.
 */
export function sampleLearningOverview(courses: ProductCourse[]): LearningOverviewDisplay {
  const catalogue = courses.filter(course => course.status === "published");
  const identity = (course: ProductCourse): OverviewCourseIdentity => ({
    courseId: course.id, slug: course.slug, title: course.title,
    category: course.categoryId || course.category || "", cover: course.cover || course.thumbnailPath || null,
  });
  const progressSamples = [46, 100, 25, 72, 0];
  return {
    learning: catalogue.map((course, index) => {
      const progress = progressSamples[index % progressSamples.length];
      const lessons = course.sections.flatMap(section => section.lessons);
      const currentLesson = progress === 100 || !lessons.length ? null : Math.min(lessons.length, Math.floor(progress / 100 * lessons.length) + 1);
      return { ...identity(course), kind: "learning", mode: index % 2 ? "text" : "video", progress, currentLesson,
        currentLessonId: currentLesson ? lessons[currentLesson - 1].id : lessons[0]?.id || null };
    }),
    previewed: catalogue.map(course => ({ ...identity(course), kind: "preview" })),
  };
}

export async function getLearningOverviewDisplay(userId: string): Promise<LearningOverviewDisplay> {
  const [courses, overview] = await Promise.all([listPublishedCourses(), getLearningOverview(userId)]);
  const display: LearningOverviewDisplay = {
    learning: courses.map(course => {
      const record = overview.courses.find(item => item.courseId === course.id);
      const lessons = course.sections.flatMap(section => section.lessons);
      const index = lessons.findIndex(lesson => lesson.id === record?.currentLessonId);
      return { courseId:course.id,slug:course.slug,title:course.title,category:course.categoryId || course.category || "",cover:course.cover || course.thumbnailPath || null,
        kind:"learning",mode:record?.mode || availableCourseLearningModes(course)[0] || "text",progress:record?.progress || 0,
        currentLesson:index >= 0 ? index + 1 : null,currentLessonId:record?.currentLessonId || lessons[0]?.id || null,currentContentId:record?.currentContentId || null };
    }),
    previewed: courses.map(course => ({courseId:course.id,slug:course.slug,title:course.title,category:course.categoryId || course.category || "",cover:course.cover || course.thumbnailPath || null,kind:"preview"})),
  };
  const covers = new Map(await Promise.all(display.learning.map(async course => [course.courseId, await signCourseMediaUrl(course.cover || "")] as const)));
  return {
    learning: display.learning.map(course => ({ ...course, cover: covers.get(course.courseId) || null })),
    previewed: display.previewed.map(course => ({ ...course, cover: covers.get(course.courseId) || null })),
  };
}
