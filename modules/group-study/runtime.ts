import { readFile } from "node:fs/promises";
import path from "node:path";
import { systemRoot } from "@/services/fileStore";
import { isManagedEnvironment } from "@/services/runtimeConfig";
import { sendStudyGroupReminderEmail } from "@/services/emailService";
import { checkEntitlement, getProductCourse, getUserById, listPublishedCourses, listStudyGroupReminders, recordUserNotification } from "@/services/productStore";
import { createPostgresStudyGroupRepository } from "@/repositories/studyGroupRepository";
import { createStudyGroupRepository } from "./repository";
import { createStudyGroupService, type StudyGroupService } from "./service";
import { createLiveKitCloudGateway } from "./liveKitCloudGateway";
import { createLiveKitHealthService, type LiveKitHealthProject, type LiveKitHealthService } from "./liveKitHealth";
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

// Auto-issued on AWS: the platform generates this key once per environment and
// App Runner injects it from Secrets Manager at instance start (see
// docs/phase1/study-group/livekit-operations.md, key rotation). Resolution is
// lazy so that data operations work before the key exists; only real issuance
// needs it. A present-but-invalid value fails fast as an operator error.
function tokenLogKeyFromEnv(): Buffer | null {
  const encoded = process.env.STUDY_GROUP_TOKEN_LOG_KEY?.trim();
  if (!encoded) return null;
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
  const rawProjects = process.env.LIVEKIT_PROJECTS_JSON?.trim();
  if (!rawProjects) {
    // Zero-config degradation: data operations (browse, create, join, schedule)
    // run normally; live-room operations answer with the typed `unavailable`
    // state until the platform enablement resolves this environment's
    // credentials. A project list that is present but invalid still fails fast.
    return { projects: null, gateway: null, providerVerified: false };
  }
  const projects = parseLiveKitProjects(rawProjects);
  const resolver = localCredentialResolver() ?? createAwsLiveKitCredentialResolver();
  const fakeGateway = (process.env.APP_ENV || "DEV").trim().toUpperCase() === "DEV" && process.env.LIVEKIT_FAKE_GATEWAY === "1";
  const gateway = createLiveKitCloudGateway({
    resolveCredentials: (project, options) => resolver.resolve(project, options),
    providerVerified: !fakeGateway,
    registry: projects,
    createRoomService: fakeGateway ? async () => ({
      createRoom: async () => undefined,
      sendData: async () => undefined,
      removeParticipant: async () => undefined,
      listRooms: async () => []
    }) : undefined
  });
  return { projects, gateway, providerVerified: !fakeGateway };
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
  if (!liveKit.projects || !liveKit.gateway) throw new Error("LiveKit health requires a configured project registry.");
  const health = createLiveKitHealthService({ registry: liveKit.projects, gateway: liveKit.gateway });
  liveKitHealthServices.set(directory, health);
  return health;
}

export async function studyGroupLiveKitHealth() {
  const directory = path.join(systemRoot(), "learning_guide", "study-group");
  const liveKit = runtimeForDirectory(directory);
  // Unconfigured environments report not-ready with an empty project list,
  // never a vacuous "zero projects are all healthy".
  if (!liveKit.projects || !liveKit.gateway) {
    return { checkedAt: new Date().toISOString(), ready: false, attentionRequired: false, projects: [] as ReadonlyArray<LiveKitHealthProject> };
  }
  return healthForDirectory(directory).check();
}

// Store selection (design §3.4), fail-closed: managed environments can never
// fall back to the container-local JSON file, and DATABASE_URL presence means
// PostgreSQL; only local DEV without PostgreSQL uses the file store.
function studyGroupPersistenceBackend(): "postgres" | "file" {
  const explicit = (process.env.STUDY_GROUP_STORE || "").trim().toLowerCase();
  if (explicit === "postgres") return "postgres";
  if (explicit === "file") {
    if (isManagedEnvironment()) throw new Error("The file Study Group store is not available in managed environments.");
    return "file";
  }
  const hasDb = Boolean(process.env.DATABASE_URL?.trim());
  if (isManagedEnvironment() || hasDb) return "postgres";
  return "file";
}

export function studyGroupService() {
  const directory = path.join(systemRoot(), "learning_guide", "study-group");
  // The cache key is the backend, not the directory: one process serves one
  // Study Group store and the reminder timer stays per store.
  const backend = studyGroupPersistenceBackend();
  const key = backend === "postgres" ? "postgres" : directory;
  const existing = services.get(key);
  if (existing) return existing;
  const liveKit = runtimeForDirectory(directory);
  const service = createStudyGroupService({
    repository: backend === "postgres" ? createPostgresStudyGroupRepository() : createStudyGroupRepository(directory),
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
    listReminders: (userId) => listStudyGroupReminders(userId),
    sendMail: async (input) => {
      try {
        await sendStudyGroupReminderEmail({ to: input.to, subject: input.subject, text: input.text });
      } catch {
        return;
      }
    },
    // Compatibility shape for local unit-service fixtures; runtime traffic uses the registry and gateway below.
    liveKit: { apiKey: "", apiSecret: "", url: "" },
    liveKitProjects: liveKit.projects ?? undefined,
    liveKitGateway: liveKit.gateway ?? undefined,
    liveKitIncidentReporter: ({ sessionId: _sessionId, ...incident }) => {
      // Session id is the LiveKit room name; correlation stays in the request
      // path and never enters the general-purpose operational log stream.
      console.info(JSON.stringify({ type: "study_group.livekit_incident", ...incident }));
    },
    tokenLogKey: tokenLogKeyFromEnv,
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
      if (!liveKit.projects || !liveKit.gateway) throw new Error("LiveKit is not configured.");
      await liveKit.gateway.publishTutorMessage({ project: liveKit.projects.getAssigned(projectId), room, text, messageId });
    }
  });
  services.set(key, service);
  const timers = globalThis as typeof globalThis & { __lgStudyGroupReminderTimers?: Set<string> };
  timers.__lgStudyGroupReminderTimers ??= new Set();
  if (!timers.__lgStudyGroupReminderTimers.has(key)) {
    timers.__lgStudyGroupReminderTimers.add(key);
    const timer = setInterval(() => {
      void service.dispatchDueReminders().catch(() => undefined);
    }, 30_000);
    timer.unref();
  }
  // One redacted signal per process when Study Group has no LiveKit project
  // configuration yet. The health timer below stays silent in that state, so
  // this line is what a CloudWatch alarm (release-runbook, Study Group gate)
  // keys on. It carries no values, no credential references and no identities.
  if (!liveKit.projects || !liveKit.gateway) {
    console.info(JSON.stringify({ type: "study_group.livekit_health", configured: false, ready: false, attentionRequired: false, projects: [] }));
  }
  const healthTimers = globalThis as typeof globalThis & { __lgStudyGroupLiveKitHealthTimers?: Set<string>; __lgStudyGroupLiveKitHealthStates?: Map<string, string> };
  healthTimers.__lgStudyGroupLiveKitHealthTimers ??= new Set();
  healthTimers.__lgStudyGroupLiveKitHealthStates ??= new Map();
  if (liveKit.projects && liveKit.gateway && !healthTimers.__lgStudyGroupLiveKitHealthTimers.has(key)) {
    const health = healthForDirectory(directory);
    healthTimers.__lgStudyGroupLiveKitHealthTimers.add(key);
    const reportHealth = () => {
      void health.check().then((snapshot) => {
        const state = snapshot.projects.map((project) => `${project.id}:${project.status}`).join(",");
        if (healthTimers.__lgStudyGroupLiveKitHealthStates?.get(key) === state) return;
        healthTimers.__lgStudyGroupLiveKitHealthStates?.set(key, state);
        console.info(JSON.stringify({ type: "study_group.livekit_health", ready: snapshot.ready, attentionRequired: snapshot.attentionRequired, projects: snapshot.projects.map(({ id, state, status, evidence, providerVerified, latencyMs, activeRooms }) => ({ id, state, status, evidence, providerVerified, latencyMs, ...(activeRooms === undefined ? {} : { activeRooms }) })) }));
      }).catch(() => undefined);
    };
    reportHealth();
    const timer = setInterval(reportHealth, 5 * 60_000);
    timer.unref();
  }
  // Bounded reconciliation timer (slice-2 design §4): sweep A plus sweep B
  // every 5 minutes, PostgreSQL store and a provider-verified gateway only
  // (the DEV fake gateway has no participant listing, so there is nothing to
  // reconcile against). A throwing tick is swallowed, same contract as the
  // reminder and health timers.
  const reconcileTimers = globalThis as typeof globalThis & { __lgStudyGroupReconcileTimers?: Set<string> };
  reconcileTimers.__lgStudyGroupReconcileTimers ??= new Set();
  if (backend === "postgres" && liveKit.providerVerified && !reconcileTimers.__lgStudyGroupReconcileTimers.has(key)) {
    reconcileTimers.__lgStudyGroupReconcileTimers.add(key);
    const timer = setInterval(() => {
      void service.reconcileLiveKitState().catch(() => undefined);
    }, 5 * 60_000);
    timer.unref();
  }
  // Redacted operational metrics timer (slice-3 design §5.2 aim): one regular
  // 5-minute sample of counts for the CloudWatch metric filters, PostgreSQL
  // store only. Unlike the health timer there is deliberately no dedupe — the
  // alarms need a steady sample — and a throwing tick is swallowed and
  // dropped, same contract as the reminder, health and reconcile timers.
  const metricsTimers = globalThis as typeof globalThis & { __lgStudyGroupMetricsTimers?: Set<string> };
  metricsTimers.__lgStudyGroupMetricsTimers ??= new Set();
  if (backend === "postgres" && !metricsTimers.__lgStudyGroupMetricsTimers.has(key)) {
    metricsTimers.__lgStudyGroupMetricsTimers.add(key);
    const timer = setInterval(() => {
      void service.operationalMetrics()
        .then((metrics) => console.info(JSON.stringify({ type: "study_group.metrics", store: "postgres", ...metrics })))
        .catch(() => undefined);
    }, 5 * 60_000);
    timer.unref();
  }
  return service;
}
