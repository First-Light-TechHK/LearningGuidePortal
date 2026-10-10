import { readFile } from "node:fs/promises";
import path from "node:path";
import { systemRoot } from "@/services/fileStore";
import { sendStudyGroupReminderEmail } from "@/services/emailService";
import { checkEntitlement, getProductCourse, getUserById, listPublishedCourses, recordUserNotification } from "@/services/productStore";
import { createStudyGroupRepository } from "./repository";
import { createStudyGroupService, type StudyGroupService } from "./service";
import { openRouterTutorCall, publishLiveKitData, readTutorKeys } from "./tutorAnswer";
import { STUDY_GROUP_TUTOR_SYSTEM_PROMPT } from "./tutorPrompt";

async function readStoredCourseKnowledge(courseId: string) {
  const course = await getProductCourse(courseId);
  const lessons = (course?.sections ?? []).flatMap((section) => section.lessons).map((lesson) => `${lesson.title}\n${lesson.body}`.trim()).filter(Boolean);
  const root = path.join(process.cwd(), "knowledge", course?.slug || courseId);
  const parts = [...lessons];
  for (const file of ["knowledge-pack.json", "canon-excerpts.md", "sources.md"]) {
    try {
      parts.push(await readFile(path.join(root, file), "utf8"));
    } catch {
      // This course has no file in the existing Course Knowledge directory.
    }
  }
  return parts.join("\n\n");
}

const services = new Map<string, StudyGroupService>();

function tokenLogKey() {
  const encoded = process.env.STUDY_GROUP_TOKEN_LOG_KEY?.trim();
  if (!encoded) return Buffer.alloc(32, 0);
  const key = Buffer.from(encoded, "base64");
  return key.length === 32 ? key : Buffer.alloc(32, 0);
}

export function studyGroupService() {
  const directory = path.join(systemRoot(), "learning_guide", "study-group");
  const existing = services.get(directory);
  if (existing) return existing;
  const service = createStudyGroupService({
    repository: createStudyGroupRepository(directory),
    now: () => new Date(),
    hasCourseAccess: async (userId, courseId) => (await checkEntitlement(userId, courseId)).allowed,
    courseSummary: async (courseId) => {
      const course = await getProductCourse(courseId);
      return course && course.status === "published" ? { id: course.id, title: course.title, slug: course.slug } : null;
    },
    courseLessons: async (courseId) => {
      const course = await getProductCourse(courseId);
      return (course?.sections ?? []).flatMap((section) => section.lessons).flatMap((lesson) => {
        const title = lesson.title.trim();
        return title ? [{ id: lesson.id, title }] : [];
      });
    },
    accessibleCourses: async (userId) => {
      const courses = await listPublishedCourses();
      const allowed = [];
      for (const course of courses) {
        if ((await checkEntitlement(userId, course.id)).allowed) allowed.push({ id: course.id, title: course.title, slug: course.slug });
      }
      return allowed;
    },
    userProfile: async (userId) => {
      const user = await getUserById(userId);
      if (!user) return null;
      return { id: user.id, displayName: user.nickname || user.id, email: user.email, locale: user.locale === "zh-CN" ? "zh-CN" : "en-GB" };
    },
    notify: async (input) => {
      await recordUserNotification(input.userId, input.title, input.body);
    },
    sendMail: async (input) => {
      try {
        await sendStudyGroupReminderEmail({ to: input.to, subject: input.subject, text: input.text });
      } catch {
        return;
      }
    },
    liveKit: {
      apiKey: process.env.LIVEKIT_API_KEY?.trim() || "",
      apiSecret: process.env.LIVEKIT_API_SECRET?.trim() || "",
      url: process.env.LIVEKIT_URL?.trim() || process.env.NEXT_PUBLIC_LIVEKIT_URL?.trim() || ""
    },
    tokenLogKey: tokenLogKey(),
    courseKnowledge: readStoredCourseKnowledge,
    tutorKeys: () => readTutorKeys(process.env.STUDY_GROUP_TUTOR_KEYS),
    tutorCall: (input) => openRouterTutorCall({
      secret: input.secret,
      model: process.env.STUDY_GROUP_TUTOR_MODEL?.trim() || process.env.OPENROUTER_MODEL?.trim() || "openrouter/auto",
      system: STUDY_GROUP_TUTOR_SYSTEM_PROMPT,
      context: input.context,
      text: input.text,
      url: process.env.STUDY_GROUP_TUTOR_URL?.trim() || undefined
    }),
    publishRoomChat: async ({ room, text }) => {
      const apiKey = process.env.LIVEKIT_API_KEY?.trim() || "";
      const apiSecret = process.env.LIVEKIT_API_SECRET?.trim() || "";
      const url = process.env.LIVEKIT_URL?.trim() || process.env.NEXT_PUBLIC_LIVEKIT_URL?.trim() || "";
      if (!apiKey || !apiSecret || !url) return;
      await publishLiveKitData({ url, apiKey, apiSecret, room, text, now: new Date() });
    }
  });
  services.set(directory, service);
  const timers = globalThis as typeof globalThis & { __lgStudyGroupReminderTimers?: Set<string> };
  timers.__lgStudyGroupReminderTimers ??= new Set();
  if (!timers.__lgStudyGroupReminderTimers.has(directory)) {
    timers.__lgStudyGroupReminderTimers.add(directory);
    const timer = setInterval(() => {
      void service.dispatchDueReminders().catch(() => undefined);
    }, 30_000);
    timer.unref();
  }
  return service;
}
