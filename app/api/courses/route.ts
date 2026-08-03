import { NextResponse } from "next/server";
import { createCourse, listCourses } from "@/services/courseStore";

export async function GET() {
  return NextResponse.json({ courses: await listCourses() });
}

export async function POST(request: Request) {
  try {
    const { title } = (await request.json()) as { title?: string };
    if (!title?.trim()) return NextResponse.json({ error: "Course name is required" }, { status: 400 });
    return NextResponse.json(await createCourse(title));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Create course failed" }, { status: 400 });
  }
}
