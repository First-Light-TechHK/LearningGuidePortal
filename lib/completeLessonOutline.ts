import type { CourseLearningMode } from "@/contracts/course-learning-mode";

export async function completeLessonOutline(endpoint: string, courseId: string, lessonId: string, learningMode: CourseLearningMode, clientEventId: string) {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    courseId, lessonId, learningMode, completeLesson: true, event: "complete", seconds: 0, clientEventId,
  }) });
  if (!response.ok) throw new Error("Lesson completion could not be saved.");
}
