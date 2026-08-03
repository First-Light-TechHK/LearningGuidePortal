import { redirect } from "next/navigation";
import { DEFAULT_COURSE_ID, DEFAULT_KNOWLEDGE_ID, listCourses } from "@/services/courseStore";

export default async function Home() {
  const courses = await listCourses();
  const firstCourse = courses.find((course) => course.knowledgeIds.length) || courses[0];
  const courseId = firstCourse?.id || DEFAULT_COURSE_ID;
  const knowledgeId = firstCourse?.knowledgeIds[0] || DEFAULT_KNOWLEDGE_ID;

  redirect(`/knowledge/${courseId}/${knowledgeId}/source-materials`);
}
