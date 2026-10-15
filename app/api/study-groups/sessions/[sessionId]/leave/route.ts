import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { sessionId } = await context.params;
  // The optional body carries the only two kinds of leaving: an unload
  // (pagehide: refresh, tab close) releases the seat without ending the
  // session, so a reload can re-enter; an absent or unknown reason is the
  // explicit Leave Session action, which keeps its immediate
  // last-participant-completes rule (PRD BR-026 / BR-027). An unreadable
  // body is the explicit action.
  const body = await request.json().catch(() => null) as { reason?: unknown } | null;
  const reason = body?.reason === "unload" ? "unload" as const : undefined;
  try {
    await studyGroupService().leaveSession({ actorUserId: user.id, sessionId, reason });
    return studyGroupData({ left: true });
  } catch (error) {
    return studyGroupFailure(error);
  }
}
