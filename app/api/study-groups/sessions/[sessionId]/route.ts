import { readJsonObject, signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { parseEditSessionBody } from "@/modules/group-study/parsers";
import { studyGroupService } from "@/modules/group-study/runtime";

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { sessionId } = await context.params;
  try {
    return studyGroupData(await studyGroupService().getSession({ actorUserId: user.id, sessionId }));
  } catch (error) {
    return studyGroupFailure(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { sessionId } = await context.params;
  try {
    const body = parseEditSessionBody(await readJsonObject(request));
    return studyGroupData(await studyGroupService().editSession({ actorUserId: user.id, sessionId, ...body }));
  } catch (error) {
    return studyGroupFailure(error);
  }
}
