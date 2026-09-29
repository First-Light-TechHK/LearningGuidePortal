import { NextResponse } from "next/server";
import { shellViewerFromUser } from "@/lib/shellViewer";
import { isAdminHost, isKnowledgeAdminPath } from "@/services/adminHost";
import { currentAuthorRequest, currentProductUserFromRequest, rejectIfUnauthenticated } from "@/services/productAuth";
import { listCourses } from "@/services/courseStore";
import { listKnowledge } from "@/services/knowledgeStore";
import { getSourceMaterialCounts } from "@/services/sourceMaterialStore";

async function signedInUser(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (isAdminHost(request) && isKnowledgeAdminPath(pathname)) return currentAuthorRequest(request);
  return currentProductUserFromRequest(request);
}

export async function GET(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const selectedCourseId = url.searchParams.get("courseId") || "philosophy";
  const selectedKnowledgeId = url.searchParams.get("knowledgeId") || "epicureanism";
  const courses = await listCourses();
  const tree = await Promise.all(
    courses.map(async (course) => ({
      ...course,
      knowledge: await listKnowledge(course.id)
    }))
  );
  const counts = selectedKnowledgeId
    ? await getSourceMaterialCounts(selectedCourseId, selectedKnowledgeId)
    : { videoCount: 0, documentCount: 0, qaNotesCount: 0 };
  return NextResponse.json({ courses: tree, counts, viewer: shellViewerFromUser(await signedInUser(request)) });
}
