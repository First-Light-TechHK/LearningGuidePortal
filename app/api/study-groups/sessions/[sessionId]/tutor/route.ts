import { acceptTutorPost } from "@/modules/group-study/tutorHttp";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  return acceptTutorPost(request, sessionId);
}
