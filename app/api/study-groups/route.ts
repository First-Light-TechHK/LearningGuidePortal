import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

export async function GET(request: Request) {
  const user = await signedInUser(request);
  const view = new URL(request.url).searchParams.get("view") || "discover";
  try {
    const service = studyGroupService();
    if (view === "mine") {
      if (!user) return unauthenticated();
      // The portal polls this view every few seconds from every client; the
      // request-triggered sweep is single-flight and throttled per process
      // (hunt L5), while the first request still dispatches immediately.
      await service.dispatchDueRemindersOnRequest();
      return studyGroupData(await service.listMine(user.id));
    }
    if (view === "courses") {
      if (!user) return unauthenticated();
      return studyGroupData(await service.listCreatableCourses(user.id));
    }
    if (view === "reminders") {
      if (!user) return unauthenticated();
      // A viewer opening the reminders strip first still gets a due reminder
      // delivered on that very request; later polls inside the window are
      // skipped like any other request-triggered sweep (hunt L5).
      await service.dispatchDueRemindersOnRequest();
      return studyGroupData(await service.listReminders(user.id));
    }
    return studyGroupData(await service.listDiscover({
      actorUserId: user?.id || null,
      courseId: new URL(request.url).searchParams.get("courseId") || undefined,
      query: new URL(request.url).searchParams.get("q") || undefined
    }));
  } catch (error) {
    return studyGroupFailure(error);
  }
}

export async function POST(request: Request) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  try {
    const body = await request.json() as { title?: string; courseId?: string; about?: string };
    return studyGroupData(await studyGroupService().createGroup({
      actorUserId: user.id,
      title: body.title || "",
      courseId: body.courseId || "",
      about: body.about || ""
    }));
  } catch (error) {
    return studyGroupFailure(error);
  }
}
