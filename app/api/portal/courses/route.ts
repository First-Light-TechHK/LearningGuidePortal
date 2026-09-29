import { NextResponse } from "next/server";
import { courseCategoryId } from "@/lib/courseDetailPresentation";
import { getPortalContent, listCatalogueEntries, listPublishedCourses } from "@/services/productStore";

export async function GET() {
  const [courses, content, catalogue] = await Promise.all([listPublishedCourses(), getPortalContent(), listCatalogueEntries()]);
  // Public catalogue fields only: author assignments and archived content stay private.
  return NextResponse.json({ ok: true, courses: courses.map(course => ({ id: course.id, slug: course.slug, title: course.title, description: course.description, category: courseCategoryId(course, content.categories, catalogue) || null, thumbnailPath: course.cover || course.thumbnailPath, status: course.status, createdAt: course.createdAt, updatedAt: course.updatedAt })) });
}
