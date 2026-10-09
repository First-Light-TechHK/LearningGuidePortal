import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

export async function POST(request: Request, context: { params: Promise<{ groupId: string }> }) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { groupId } = await context.params;
  try {
    const body = await request.json() as {
      title?: string;
      startsAt?: string;
      durationSeconds?: number;
      maxParticipants?: number;
      relatedLessonId?: string | null;
      focus?: string | null;
      aiTutorEnabled?: boolean;
    };
    return studyGroupData(await studyGroupService().scheduleSession({
      actorUserId: user.id,
      groupId,
      title: body.title || "",
      startsAt: body.startsAt || "",
      durationSeconds: Number(body.durationSeconds),
      maxParticipants: Number(body.maxParticipants),
      relatedLessonId: body.relatedLessonId,
      focus: body.focus,
      aiTutorEnabled: body.aiTutorEnabled
    }));
  } catch (error) {
    return studyGroupFailure(error);
  }
}
