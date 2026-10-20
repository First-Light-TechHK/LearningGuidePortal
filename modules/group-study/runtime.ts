import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { systemRoot } from "@/services/fileStore";
import { isManagedEnvironment } from "@/services/runtimeConfig";
import { sendStudyGroupReminderEmail } from "@/services/emailService";
import { checkEntitlement, getProductCourse, getUserById, listPublishedCourses, listStudyGroupReminders, recordUserNotification, withdrawStudyGroupReminders } from "@/services/productStore";
import { createPostgresStudyGroupRepository } from "@/repositories/studyGroupRepository";
import { STARTING_SOON_MS, type StudyGroupStore } from "./domain";
import { createStudyGroupRepository } from "./repository";
import { createStudyGroupService, webhookRejectionLogLine, type StudyGroupService, type UserProfile } from "./service";
import { createLiveKitCloudGateway } from "./liveKitCloudGateway";
import { createLiveKitHealthService, type LiveKitHealthProject, type LiveKitHealthService } from "./liveKitHealth";
import { createHotLiveKitProjectRegistry, parseLiveKitProjects } from "./liveKitProjectRegistry";
import { awsRegion } from "@/services/persistence/config";
import { createAwsLiveKitCredentialResolver, createAwsSecretValueReader, createLiveKitCredentialResolver } from "@/services/liveKitCredentials";
import { openRouterTutorCall } from "./tutorAnswer";
import { studyGroupTutorKeySource } from "@/services/tutorKeySource";
import { STUDY_GROUP_TUTOR_SYSTEM_PROMPT } from "./tutorPrompt";

// Tutor model settings live here, in one place, so a later backoffice
// knowledge base can become their source without touching call sites.
// STUDY_GROUP_TUTOR_MAX_TOKENS is a runaway guard (see tutorAnswer.ts), and
// STUDY_GROUP_TUTOR_REASONING pins an explicit reasoning effort; when unset,
// the shared OpenRouter layer keeps its CoT default (off, auto-stripped on 400).
function tutorMaxTokensFromEnv() {
  const raw = Number.parseInt(process.env.STUDY_GROUP_TUTOR_MAX_TOKENS?.trim() || "", 10);
  return Number.isFinite(raw) && raw >= 64 && raw <= 4096 ? raw : 700;
}

function tutorReasoningFromEnv(): { effort: string } | undefined {
  const raw = process.env.STUDY_GROUP_TUTOR_REASONING?.trim().toLowerCase();
  return raw === "none" || raw === "minimal" || raw === "low" || raw === "medium" || raw === "high" ? { effort: raw } : undefined;
}

async function readStoredCourseKnowledge(courseId: string) {
  const course = await getProductCourse(courseId);
  const lessons = (course?.sections ?? []).flatMap((section) => section.lessons).map((lesson) => `${lesson.title}\n${lesson.body}`.trim()).filter(Boolean);
  const root = path.join(process.cwd(), "knowledge", course?.slug || courseId);
  const parts = [...lessons];
  // The whole Course Knowledge directory goes to the tutor verbatim (owner
  // decision): every file, sorted by name, each headed by its filename so the
  // model can tell the sources apart. No whitelist and no pre-filtering — the
  // model itself fuzzy-matches a question against the raw material.
  let names: string[] = [];
  try {
    names = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    // This course has no Course Knowledge directory: lessons only.
  }
  for (const name of names) {
    try {
      parts.push(`# ${name}\n${await readFile(path.join(root, name), "utf8")}`);
    } catch {
      // An unreadable file is skipped like a missing one.
    }
  }
  return parts.join("\n\n");
}

// BUG-0109: a T-10 reminder row is a pending prompt only while the situation
// that produced it still holds — the Live Session is still scheduled and
// inside its Starting Soon window (never started, never past its start), the
// Study Group is still active, the viewer is still an active member, and a
// non-host viewer still has a live Plan to Attend. The reminders view applies
// this as its read-side backstop; the cancelling actions withdraw the rows
// they invalidate first (storage honesty). Exported for the unit test that
// pins the view's validity contract.
export function studyGroupReminderStillValid(store: StudyGroupStore, userId: string, sessionId: string, nowMs: number = Date.now()) {
  const session = store.sessions.find((item) => item.id === sessionId);
  if (!session || session.status !== "scheduled") return false;
  const startsAt = Date.parse(session.startsAt);
  if (!Number.isFinite(startsAt)) return false;
  if (nowMs >= startsAt || nowMs < startsAt - STARTING_SOON_MS) return false;
  const group = store.groups.find((item) => item.id === session.groupId && item.status === "active");
  if (!group) return false;
  if (!store.memberships.some((item) => item.groupId === group.id && item.userId === userId && !item.leftAt)) return false;
  if (group.hostUserId === userId) return true;
  return store.intents.some((item) => item.sessionId === session.id && item.userId === userId && !item.cancelledAt);
}

// Reminder notifications recorded before the sessionId linkage existed (the
// pre-BUG-0109 rows already in production) carry the Session title inside
// their body: "<title> starts in 10 minutes." / "<title> 将在 10 分钟后开始。"
// (the copy dispatchDueReminders wrote then; its rows now always carry their
// sessionId, so only those old rows need this). Recover the title so those
// rows can be resolved back to their Live Session through the viewer's own
// recorded reminder rows and judged by the same validity rule — otherwise a
// currently valid pre-deploy reminder would be withheld alongside the stale
// ones it sits next to. The suffixes mirror that earlier dispatch copy.
const REMINDER_BODY_SUFFIXES = [" starts in 10 minutes.", " 将在 10 分钟后开始。"];

function reminderBodyTitle(body: string): string | null {
  for (const suffix of REMINDER_BODY_SUFFIXES) {
    if (body.endsWith(suffix)) return body.slice(0, -suffix.length);
  }
  return null;
}

// The reminders view's per-notification predicate: session-linked rows are
// judged directly, and a row sent before the current Start Time's window was
// sent for an earlier Start Time, so it is stale even when its withdrawal
// failed (QA r3 server 7d); the view also shows only the newest row per
// Session. A pre-linkage row shows only while at least one Live Session with
// its title, already recorded as reminded for this viewer, is still a
// pending Session (its reminder row is kept as the dispatch record).
export function studyGroupReminderNotificationStillValid(
  store: StudyGroupStore,
  userId: string,
  item: { body: string; sessionId?: string; createdAt?: string },
  nowMs: number = Date.now()
) {
  if (item.sessionId) {
    if (!studyGroupReminderStillValid(store, userId, item.sessionId, nowMs)) return false;
    const startsAt = Date.parse(store.sessions.find((row) => row.id === item.sessionId)?.startsAt ?? "");
    const sentAt = Date.parse(item.createdAt ?? "");
    return !Number.isFinite(sentAt) || sentAt >= startsAt - STARTING_SOON_MS;
  }
  const title = reminderBodyTitle(item.body);
  if (!title) return false;
  return store.reminders.some((row) => {
    if (row.userId !== userId) return false;
    const session = store.sessions.find((itemSession) => itemSession.id === row.sessionId);
    return Boolean(session && session.title === title && studyGroupReminderStillValid(store, userId, session.id, nowMs));
  });
}

// The reminders view's reader (audit F-6): the strip is polled every 3 s by
// every signed-in client, and the validity predicate needs the full Study
// Group store only when the viewer actually has a candidate reminder row —
// then exactly one snapshot per call, shared by every row, with no cache
// across calls (each call judges against that request's own state, so a
// rescheduled or started Session is filtered on the very next poll). A
// viewer without pending rows never touches the store; the cancelling
// actions keep withdrawing their rows from storage, so a cancelled reminder
// disappears immediately, without any read. Exported for the unit test that
// pins the read behaviour.
export function createReminderListReader(repository: { read(): Promise<StudyGroupStore> }) {
  return async (userId: string) => {
    let snapshot: Promise<StudyGroupStore> | null = null;
    return listStudyGroupReminders(userId, (item) =>
      (snapshot ??= repository.read()).then((store) => studyGroupReminderNotificationStillValid(store, userId, item)));
  };
}

// A learner's Study Group profile. A learner without a nickname has an empty
// displayName: each place that shows a name chooses its own stand-in (the
// roster and the video tiles show the user id, as before; the AI Tutor's
// "replying to" line shows "a participant" instead of the id; QA r3-B3).
export function studyGroupProfile(user: { id: string; nickname?: string | null; email: string | null; locale?: string | null }): UserProfile {
  return { id: user.id, displayName: user.nickname || "", email: user.email, locale: user.locale === "zh-CN" ? "zh-CN" : "en-GB" };
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
  const projectsSecretId = process.env.LIVEKIT_PROJECTS_SECRET_ID?.trim();
  const rawProjects = process.env.LIVEKIT_PROJECTS_JSON?.trim();
  if (!projectsSecretId && !rawProjects) {
    // Zero-config degradation: data operations (browse, create, join, schedule)
    // run normally; live-room operations answer with the typed `unavailable`
    // state until the platform enablement resolves this environment's
    // credentials. A project list that is present but invalid still fails fast.
    return { projects: null, gateway: null, providerVerified: false };
  }
  // Explicit region: the rest of the persistence stack resolves through
  // awsRegion() with its ap-southeast-1 fallback; the SDK default chain alone
  // would throw "Region is missing" if the platform ever stops setting
  // AWS_REGION.
  const secrets = createAwsSecretValueReader({ region: awsRegion() });
  // With LIVEKIT_PROJECTS_SECRET_ID the list is read hot from that secret
  // (same JSON as LIVEKIT_PROJECTS_JSON, which is then ignored); a rejected
  // read keeps the last good list and logs one redacted line, never a value.
  const projects = projectsSecretId
    ? createHotLiveKitProjectRegistry({
      read: () => secrets.getSecretValue(projectsSecretId),
      onRejected: (reason) => console.info(JSON.stringify({ type: "study_group.livekit_projects_rejected", reason }))
    })
    : parseLiveKitProjects(rawProjects);
  const resolver = localCredentialResolver() ?? createAwsLiveKitCredentialResolver({ reader: secrets });
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
  // Swallowed reminder-mail failures are counted per instance (counts only —
  // never an address or a message) and drained into one redacted line on the
  // metrics cadence below, mirroring the webhook-rejection counter.
  let reminderMailFailures = 0;
  const repository = backend === "postgres" ? createPostgresStudyGroupRepository() : createStudyGroupRepository(directory);
  const service = createStudyGroupService({
    repository,
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
      return user ? studyGroupProfile(user) : null;
    },
    notify: async (input) => {
      await recordUserNotification(input.userId, input.title, input.body, input.sessionId);
    },
    // The reminders view reads the pending "Live Session reminder" rows and
    // re-checks each one against the current store through the module's own
    // validity rule: the read-side backstop behind the cancelling actions'
    // withdrawals (BUG-0109), taken lazily (audit F-6) so a viewer with no
    // candidate rows — the common case under the 3 s poll — performs no
    // Study Group store read at all.
    listReminders: createReminderListReader(repository),
    withdrawReminders: async (input) => {
      await withdrawStudyGroupReminders(input);
    },
    sendMail: async (input) => {
      try {
        await sendStudyGroupReminderEmail({ to: input.to, subject: input.subject, text: input.text });
      } catch {
        reminderMailFailures += 1;
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
    operationalLog: (event) => console.info(JSON.stringify(event)),
    courseKnowledge: readStoredCourseKnowledge,
    tutorKeys: (options) => studyGroupTutorKeySource(awsRegion()).keys(options),
    tutorCall: (input) => openRouterTutorCall({
      secret: input.secret,
      model: process.env.STUDY_GROUP_TUTOR_MODEL?.trim() || process.env.OPENROUTER_MODEL?.trim() || "openrouter/auto",
      system: STUDY_GROUP_TUTOR_SYSTEM_PROMPT,
      context: input.context,
      text: input.text,
      maxTokens: tutorMaxTokensFromEnv(),
      reasoning: tutorReasoningFromEnv(),
      url: process.env.STUDY_GROUP_TUTOR_URL?.trim() || undefined,
      timeoutMs: input.timeoutMs
    }),
    publishRoomChat: async ({ room, text, projectId, messageId, mode, replyTo }) => {
      if (!projectId) throw new Error("LiveKit room is not assigned to a project.");
      if (!liveKit.projects || !liveKit.gateway) throw new Error("LiveKit is not configured.");
      await liveKit.projects.refresh?.();
      await liveKit.gateway.publishTutorMessage({ project: liveKit.projects.getAssigned(projectId), room, text, messageId, mode, replyTo });
    }
  });
  services.set(key, service);
  const timers = globalThis as typeof globalThis & { __lgStudyGroupReminderTimers?: Set<string> };
  timers.__lgStudyGroupReminderTimers ??= new Set();
  if (!timers.__lgStudyGroupReminderTimers.has(key)) {
    timers.__lgStudyGroupReminderTimers.add(key);
    const timer = setInterval(() => {
      // Seat leases and abandoned live sessions are swept on every backend
      // (presence.ts); the reminder dispatch shares the cadence.
      void service.sweepPresence().catch(() => undefined);
      void service.dispatchDueReminders().catch(() => undefined);
    }, 15_000);
    timer.unref();
  }
  // Redacted signal while Study Group has no LiveKit project list. Without
  // any configuration the health timer below does not run, so this line is
  // what a CloudWatch alarm (release-runbook, Study Group gate) keys on; a hot
  // list with no good read yet gets the same line from the health timer. It
  // carries no values, no credential references and no identities. It repeats
  // on the health cadence: a service that goes idle after its first request
  // must still produce the line, otherwise the alarm goes quiet exactly when
  // it matters.
  const emitUnconfigured = () => console.info(JSON.stringify({ type: "study_group.livekit_health", configured: false, ready: false, attentionRequired: false, projects: [] }));
  if (!liveKit.projects || !liveKit.gateway) {
    emitUnconfigured();
    const timer = setInterval(emitUnconfigured, 5 * 60_000);
    timer.unref();
  }
  const healthTimers = globalThis as typeof globalThis & { __lgStudyGroupLiveKitHealthTimers?: Set<string>; __lgStudyGroupLiveKitHealthStates?: Map<string, string> };
  healthTimers.__lgStudyGroupLiveKitHealthTimers ??= new Set();
  healthTimers.__lgStudyGroupLiveKitHealthStates ??= new Map();
  if (liveKit.projects && liveKit.gateway && !healthTimers.__lgStudyGroupLiveKitHealthTimers.has(key)) {
    const health = healthForDirectory(directory);
    healthTimers.__lgStudyGroupLiveKitHealthTimers.add(key);
    const reportHealth = () => {
      void health.check().then((snapshot) => {
        if (snapshot.projects.length === 0) {
          healthTimers.__lgStudyGroupLiveKitHealthStates?.delete(key);
          emitUnconfigured();
          return;
        }
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
  // Bounded reconciliation timer (slice-2 design §4): sweep A (stale webhook
  // receipts) every 5 minutes, PostgreSQL store and a provider-verified
  // gateway only. Seats are swept by the timer above on every backend. A tick that repaired or abandoned anything logs one
  // redacted summary line; a throwing tick logs the redacted
  // study_group.reconcile_failed line (the release-gate alarm keys on it) —
  // never error detail, same contract as the reminder and health timers.
  const reconcileTimers = globalThis as typeof globalThis & { __lgStudyGroupReconcileTimers?: Set<string> };
  reconcileTimers.__lgStudyGroupReconcileTimers ??= new Set();
  if (backend === "postgres" && liveKit.providerVerified && !reconcileTimers.__lgStudyGroupReconcileTimers.has(key)) {
    reconcileTimers.__lgStudyGroupReconcileTimers.add(key);
    const timer = setInterval(() => {
      void (async () => {
        try {
          const result = await service.reconcileLiveKitState();
          if (result.abandonedReceipts > 0 || result.presencesClosed > 0) {
            console.info(JSON.stringify({ type: "study_group.reconcile", ...result }));
          }
        } catch {
          // Redacted failure signal only: no error detail reaches the log.
          console.info(JSON.stringify({ type: "study_group.reconcile_failed" }));
        }
      })();
    }, 5 * 60_000);
    timer.unref();
  }
  // Dedicated tutor-recovery timer (global review risk 1): exclusively the
  // crashed-process fallback — a live process retries its own failed work on
  // the outbox backoff (scheduleTutorRetry in the service), so only work
  // stranded by a process that died remains here, and the 60s claim lease
  // plus this tick bound its recovery latency; the lease cannot be shortened
  // without risking two instances answering at once. Gated like the
  // reconcile timer, with one immediate run so a freshly booted instance
  // picks up work stranded by the previous one; a throwing tick is swallowed,
  // same contract as the sweep above.
  const tutorRecoveryTimers = globalThis as typeof globalThis & { __lgStudyGroupTutorRecoveryTimers?: Set<string> };
  tutorRecoveryTimers.__lgStudyGroupTutorRecoveryTimers ??= new Set();
  if (backend === "postgres" && liveKit.providerVerified && !tutorRecoveryTimers.__lgStudyGroupTutorRecoveryTimers.has(key)) {
    tutorRecoveryTimers.__lgStudyGroupTutorRecoveryTimers.add(key);
    void service.recoverTutorWork().catch(() => undefined);
    const timer = setInterval(() => {
      void service.recoverTutorWork().catch(() => undefined);
    }, 15 * 1000);
    timer.unref();
  }
  // Redacted operational metrics timer (slice-3 design §5.2 aim): one regular
  // 5-minute sample of counts for the CloudWatch metric filters, PostgreSQL
  // store only. Unlike the health timer there is deliberately no dedupe — the
  // alarms need a steady sample — and a throwing tick is swallowed and
  // dropped, same contract as the reminder, health and reconcile timers.
  // On the same cadence, signature rejections drain first: at most one redacted
  // line per tick (never per rejection, so sustained invalid_signature 400s
  // cannot flood the log), consumed synchronously so a failing metrics sample
  // below can never lose a count. The same cadence drains swallowed
  // reminder-mail failures the same way: one redacted count line per tick.
  const metricsTimers = globalThis as typeof globalThis & { __lgStudyGroupMetricsTimers?: Set<string> };
  metricsTimers.__lgStudyGroupMetricsTimers ??= new Set();
  if (backend === "postgres" && !metricsTimers.__lgStudyGroupMetricsTimers.has(key)) {
    metricsTimers.__lgStudyGroupMetricsTimers.add(key);
    const timer = setInterval(() => {
      const rejectionLine = webhookRejectionLogLine(service);
      if (rejectionLine) console.info(rejectionLine);
      if (reminderMailFailures > 0) {
        console.info(JSON.stringify({ type: "study_group.reminder_mail_failed", count: reminderMailFailures }));
        reminderMailFailures = 0;
      }
      void service.operationalMetrics()
        .then((metrics) => console.info(JSON.stringify({ type: "study_group.metrics", store: "postgres", ...metrics })))
        .catch(() => undefined);
    }, 5 * 60_000);
    timer.unref();
  }
  return service;
}
