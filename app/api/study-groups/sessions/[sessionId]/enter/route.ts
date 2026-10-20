import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

let receipt = 0;

// The service orders admissions itself (its entry queue); the sign-in is
// read outside it, so a slow lookup here never holds other entries up.
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const requestedAt = `${new Date().toISOString()}#${String(++receipt).padStart(8, "0")}`;
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { sessionId } = await context.params;
  try {
    return studyGroupData(await studyGroupService().enterSession({
      actorUserId: user.id,
      sessionId,
      requestedAt
    }));
  } catch (error) {
    return studyGroupFailure(error);
  }
}
