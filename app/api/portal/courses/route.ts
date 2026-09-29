import { NextResponse } from "next/server";
import { courseCategoryMembership } from "@/lib/courseDetailPresentation";
import { listCatalogueEntries, listPublishedCourses } from "@/services/productStore";

export async function GET() {
  const [courses, catalogue] = await Promise.all([listPublishedCourses(), listCatalogueEntries()]);
  // Public catalogue fields only: author assignments and archived content stay private.
  return NextResponse.json({ ok: true, courses: courses.map(course => ({ id: course.id, slug: course.slug, title: course.title, description: course.description, category: courseCategoryMembership(course, catalogue) || null, thumbnailPath: course.cover || course.thumbnailPath, status: course.status, createdAt: course.createdAt, updatedAt: course.updatedAt })) });
}
