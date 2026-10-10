import { readFile } from "node:fs/promises";
import path from "node:path";
import { systemRoot } from "@/services/fileStore";
import { sendStudyGroupReminderEmail } from "@/services/emailService";
import { checkEntitlement, getProductCourse, getUserById, listPublishedCourses, recordUserNotification } from "@/services/productStore";
import { createStudyGroupRepository } from "./repository";
import { createStudyGroupService, type StudyGroupService } from "./service";
import { createLiveKitCloudGateway } from "./liveKitCloudGateway";
import { createLiveKitHealthService, type LiveKitHealthService } from "./liveKitHealth";
import { parseLiveKitProjects } from "./liveKitProjectRegistry";
import { createAwsLiveKitCredentialResolver, createLiveKitCredentialResolver } from "@/services/liveKitCredentials";
import { openRouterTutorCall, readTutorKeys } from "./tutorAnswer";
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
const liveKitHealthServices = new Map<string, LiveKitHealthService>();
const liveKitRuntimes = new Map<string, ReturnType<typeof liveKitRuntime>>();

function tokenLogKey() {
  const encoded = process.env.STUDY_GROUP_TOKEN_LOG_KEY?.trim();
  if (!encoded) throw new Error("STUDY_GROUP_TOKEN_LOG_KEY is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("STUDY_GROUP_TOKEN_LOG_KEY must be a 32-byte base64 value.");
  return key;
}

function localCredentialResolver() {
  if ((process.env.APP_ENV || "DEV").trim().toUpperCase() !== "DEV") return null;
  const raw = process.env.LIVEKIT_LOCAL_CREDENTIALS_JSON?.trim();
  if (!raw) return null;
  let values: unknown;
  try {
    values = JSON.parse(raw);
  } catch {
    throw new Error("LIVEKIT_LOCAL_CREDENTIALS_JSON is not valid JSON.");
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("LIVEKIT_LOCAL_CREDENTIALS_JSON must be an object.");
  const entries = values as Record<string, unknown>;
  return createLiveKitCredentialResolver({
    async getSecretValue(secretId) {
      const value = entries[secretId];
      return value === undefined ? undefined : JSON.stringify(value);
    }
  });
}

function liveKitRuntime() {
  const projects = parseLiveKitProjects(process.env.LIVEKIT_PROJECTS_JSON);
  const resolver = localCredentialResolver() ?? createAwsLiveKitCredentialResolver();
  const fakeGateway = (process.env.APP_ENV || "DEV").trim().toUpperCase() === "DEV" && process.env.LIVEKIT_FAKE_GATEWAY === "1";
  const gateway = createLiveKitCloudGateway({
    resolveCredentials: (project, options) => resolver.resolve(project, options),
    providerVerified: !fakeGateway,
    createRoomService: fakeGateway ? async () => ({
      createRoom: async () => undefined,
      sendData: async () => undefined,
      removeParticipant: async () => undefined,
      listRooms: async () => []
    }) : undefined
  });
  return { projects, gateway };
}

function runtimeForDirectory(directory: string) {
  const existing = liveKitRuntimes.get(directory);
  if (existing) return existing;
  const runtime = liveKitRuntime();
  liveKitRuntimes.set(directory, runtime);
  return runtime;
}

function healthForDirectory(directory: string) {
  const existing = liveKitHealthServices.get(directory);
  if (existing) return existing;
  const liveKit = runtimeForDirectory(directory);
  const health = createLiveKitHealthService({ registry: liveKit.projects, gateway: liveKit.gateway });
  liveKitHealthServices.set(directory, health);
  return health;
}

export async function studyGroupLiveKitHealth() {
  const directory = path.join(systemRoot(), "learning_guide", "study-group");
  return healthForDirectory(directory).check();
}

export function studyGroupService() {
  const directory = path.join(systemRoot(), "learning_guide", "study-group");
  const existing = services.get(directory);
  if (existing) return existing;
  const liveKit = runtimeForDirectory(directory);
  const health = healthForDirectory(directory);
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
    // Compatibility shape for local unit-service fixtures; runtime traffic uses the registry and gateway below.
    liveKit: { apiKey: "", apiSecret: "", url: "" },
    liveKitProjects: liveKit.projects,
    liveKitGateway: liveKit.gateway,
    liveKitIncidentReporter: ({ sessionId: _sessionId, ...incident }) => {
      // Session id is the LiveKit room name; correlation stays in the request
      // path and never enters the general-purpose operational log stream.
      console.info(JSON.stringify({ type: "study_group.livekit_incident", ...incident }));
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
    publishRoomChat: async ({ room, text, projectId, messageId }) => {
      if (!projectId) throw new Error("LiveKit room is not assigned to a project.");
      await liveKit.gateway.publishTutorMessage({ project: liveKit.projects.getAssigned(projectId), room, text, messageId });
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
  const healthTimers = globalThis as typeof globalThis & { __lgStudyGroupLiveKitHealthTimers?: Set<string>; __lgStudyGroupLiveKitHealthStates?: Map<string, string> };
  healthTimers.__lgStudyGroupLiveKitHealthTimers ??= new Set();
  healthTimers.__lgStudyGroupLiveKitHealthStates ??= new Map();
  const reportHealth = () => {
    void health.check().then((snapshot) => {
      const state = snapshot.projects.map((project) => `${project.id}:${project.status}`).join(",");
      if (healthTimers.__lgStudyGroupLiveKitHealthStates?.get(directory) === state) return;
      healthTimers.__lgStudyGroupLiveKitHealthStates?.set(directory, state);
      console.info(JSON.stringify({ type: "study_group.livekit_health", ready: snapshot.ready, attentionRequired: snapshot.attentionRequired, projects: snapshot.projects.map(({ id, state, status, evidence, providerVerified, latencyMs, activeRooms }) => ({ id, state, status, evidence, providerVerified, latencyMs, ...(activeRooms === undefined ? {} : { activeRooms }) })) }));
    }).catch(() => undefined);
  };
  if (!healthTimers.__lgStudyGroupLiveKitHealthTimers.has(directory)) {
    healthTimers.__lgStudyGroupLiveKitHealthTimers.add(directory);
    reportHealth();
    const timer = setInterval(reportHealth, 5 * 60_000);
    timer.unref();
  }
  return service;
}
