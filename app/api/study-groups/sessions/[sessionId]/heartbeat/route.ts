import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

// The seat holder's heartbeat: renews the caller's seat lease and reports
// whether the seat is still held (modules/group-study/presence.ts).
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { sessionId } = await context.params;
  try {
    return studyGroupData(await studyGroupService().heartbeat({ actorUserId: user.id, sessionId }));
  } catch (error) {
    return studyGroupFailure(error);
  }
}
