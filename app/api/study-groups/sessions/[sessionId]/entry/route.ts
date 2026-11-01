import { signedInUser, studyGroupData, studyGroupFailure } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

// Where a link to a Live Session sends the viewer. Open to signed-out
// visitors: they are only told to sign in.
export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await signedInUser(request);
  const { sessionId } = await context.params;
  try {
    return studyGroupData(await studyGroupService().sessionEntry({ actorUserId: user?.id ?? null, sessionId }));
  } catch (error) {
    return studyGroupFailure(error);
  }
}
