import { acceptTutorPost, acceptTutorWithdraw } from "@/modules/group-study/tutorHttp";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  return acceptTutorPost(request, sessionId);
}

export async function DELETE(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  return acceptTutorWithdraw(request, sessionId);
}
