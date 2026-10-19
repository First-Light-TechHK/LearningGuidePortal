import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { sessionId } = await context.params;
  // An absent or unknown reason is the explicit Leave Session action (PRD
  // BR-026 / BR-027). "unload" comes only from clients built before the seat
  // lease and is a no-op: the seat lapses on its own (presence.ts).
  const body = await request.json().catch(() => null) as { reason?: unknown } | null;
  const reason = body?.reason === "unload" ? "unload" as const : undefined;
  try {
    await studyGroupService().leaveSession({ actorUserId: user.id, sessionId, reason });
    return studyGroupData({ left: true });
  } catch (error) {
    return studyGroupFailure(error);
  }
}
