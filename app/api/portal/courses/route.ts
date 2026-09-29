import { NextResponse } from "next/server";
import { listPublishedCourses } from "@/services/productStore";

export async function GET() {
  const courses = await listPublishedCourses();
  // Public catalogue fields only: author assignments and archived content stay private.
  return NextResponse.json({ ok: true, courses: courses.map(course => ({ id: course.id, slug: course.slug, title: course.title, description: course.description, category: course.category, thumbnailPath: course.cover || course.thumbnailPath, status: course.status, createdAt: course.createdAt, updatedAt: course.updatedAt })) });
}
