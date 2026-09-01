import { NextResponse } from "next/server";
import { listPublishedCourses } from "@/services/productStore";

export async function GET() {
  const courses = await listPublishedCourses();
  return NextResponse.json({ ok: true, courses: courses.map(({ sections: _sections, ...course }) => course) });
}
