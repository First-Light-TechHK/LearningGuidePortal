import path from "path";
import { atomicWriteJson, ensureDir, now, readJson, safeSegment } from "./fileStore";
import { getCourse } from "./courseStore";
import { getKnowledge, knowledgeDir } from "./knowledgeStore";
import { downloadRelease, listReleases } from "./releaseStore";
import { DEFAULT_MODEL_ID, displayModelLabel, findConfiguredModel, listConfiguredModels } from "./modelStore";
import { ChatMode, ChatRoute, getPromptSettings, getRouteConfig, PromptSettings, saveRouteConfig } from "./chatTestingStore";

export type DialogueRole = "user" | "assistant";

export type DialogueMessage = {
  id: string;
  role: DialogueRole;
  content: string;
  createdAt: string;
  error?: boolean;
};

export type DialogueSessionConfig = Omit<ChatRoute, "id"> & {
  updatedAt: string;
};

export type DialogueSession = {
  mode: ChatMode;
  config: DialogueSessionConfig;
  messages: DialogueMessage[];
  updatedAt: string;
};

export type DialogueRouteSession = {
  routeId: string;
  messages: DialogueMessage[];
  updatedAt: string;
};

export type DialogueMultiSession = {
  mode: ChatMode;
  sessions: DialogueRouteSession[];
  updatedAt: string;
};

export type DialogueAssessmentResult = {
  assessment_type: "humanities_conversation_window_assessment";
  scope: "selected_dialogue_window";
  turn_count: number;
  selection_method: "default_latest_turns" | "user_selected_turns";
  subject: "philosophy" | "literature" | "history" | "other_humanities";
  topic: string;
  overall_quality: "strong" | "mostly_good" | "partial" | "weak" | "unclear";
  benchmark_band: "Strong" | "Partial" | "Weak" | "Not enough evidence";
  student_understands: string[];
  student_gaps: string[];
  diagnosis: string;
  dominant_learning_need: string;
  assessment_operation: "probe" | "diagnose_and_probe" | "conclude" | "redirect_then_probe";
  next_question: string | null;
  learner_state_update: { target: string; status: "stable" | "partial" | "weak" | "misunderstood" | "introduced" | "unknown" }[];
};

export type DialogueAssessmentRecord = {
  id: string;
  createdAt: string;
  routeId: string;
  model: string;
  releaseId: string | null;
  selectedRounds: { index: number; user: DialogueMessage; assistant: DialogueMessage }[];
  result: DialogueAssessmentResult;
};

const MAX_CONTEXT_MESSAGES = 20;
const STREAM_ERROR_PREFIX = "__DIALOGUE_TESTING_ERROR__:";
const OPENROUTER_FIRST_TOKEN_TIMEOUT_MS = 20000;
const OPENROUTER_STREAM_IDLE_TIMEOUT_MS = 15000;

function dialogueTestingDir(courseId: string, knowledgeId: string) {
  return path.join(knowledgeDir(courseId, knowledgeId), "dialogue_testing");
}

function sessionConfigPath(courseId: string, knowledgeId: string) {
  return path.join(dialogueTestingDir(courseId, knowledgeId), "session_config.json");
}

function sessionPath(courseId: string, knowledgeId: string) {
  return path.join(dialogueTestingDir(courseId, knowledgeId), "session.json");
}

function dialogueDebugPath(courseId: string, knowledgeId: string) {
  return path.join(dialogueTestingDir(courseId, knowledgeId), "debug", "last_send.json");
}

function dialogueDir(courseId: string, knowledgeId: string) {
  return path.join(knowledgeDir(courseId, knowledgeId), "dialogue");
}

function dialogueSessionPath(courseId: string, knowledgeId: string) {
  return path.join(dialogueDir(courseId, knowledgeId), "session.json");
}

function dialogueStandaloneDebugPath(courseId: string, knowledgeId: string) {
  return path.join(dialogueDir(courseId, knowledgeId), "debug", "last_send.json");
}

function dialogueAssessmentPath(courseId: string, knowledgeId: string) {
  return path.join(dialogueDir(courseId, knowledgeId), "assessments.json");
}

function dialogueAssessmentDebugPath(courseId: string, knowledgeId: string) {
  return path.join(dialogueDir(courseId, knowledgeId), "debug", "last_assessment.json");
}

export async function getLatestStandaloneDialogueAssessment(courseIdValue: string, knowledgeIdValue: string) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const assessments = await readJson<DialogueAssessmentRecord[]>(dialogueAssessmentPath(courseId, knowledgeId), []);
  return assessments[0] || null;
}

function messageId(role: DialogueRole) {
  return `${role}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

async function defaultSessionConfig(courseId: string, knowledgeId: string): Promise<DialogueSessionConfig> {
  const releases = await listReleases(courseId, knowledgeId);
  const releaseId = releases[0]?.id || null;
  const model = findConfiguredModel(DEFAULT_MODEL_ID)!;
  return {
    model: DEFAULT_MODEL_ID,
    modelLabel: displayModelLabel(model),
    useKnowledge: Boolean(releaseId),
    releaseId,
    updatedAt: now()
  };
}

function normaliseConfig(config: Partial<DialogueSessionConfig> | null | undefined, releases: { id: string }[]): DialogueSessionConfig {
  const model = findConfiguredModel(config?.model || DEFAULT_MODEL_ID) || findConfiguredModel(DEFAULT_MODEL_ID)!;
  const releaseExists = releases.some((release) => release.id === config?.releaseId);
  const useKnowledge = Boolean(config?.useKnowledge && config?.releaseId && releaseExists);
  return {
    model: model.id,
    modelLabel: displayModelLabel(model),
    useKnowledge,
    releaseId: useKnowledge ? config!.releaseId! : null,
    updatedAt: config?.updatedAt || now()
  };
}

function normaliseMessages(messages: DialogueMessage[] | undefined) {
  return (messages || [])
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.content?.trim())
    .map((message) => ({
      id: message.id || messageId(message.role),
      role: message.role,
      content: message.content,
      createdAt: message.createdAt || now(),
      ...(message.error ? { error: true } : {})
    }));
}

function completeDialogueRounds(messages: DialogueMessage[]) {
  const rounds: { index: number; user: DialogueMessage; assistant: DialogueMessage }[] = [];
  const normalised = normaliseMessages(messages);
  for (let index = 0; index < normalised.length - 1; index += 1) {
    const user = normalised[index];
    const assistant = normalised[index + 1];
    if (user.role !== "user" || assistant.role !== "assistant" || assistant.error) continue;
    rounds.push({ index: rounds.length, user, assistant });
    index += 1;
  }
  return rounds;
}

export async function getDialogueSessionConfig(courseIdValue: string, knowledgeIdValue: string) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const releases = await listReleases(courseId, knowledgeId);
  const stored = await readJson<DialogueSessionConfig | null>(sessionConfigPath(courseId, knowledgeId), null);
  return stored ? normaliseConfig(stored, releases) : defaultSessionConfig(courseId, knowledgeId);
}

export async function saveDialogueSessionConfig(courseIdValue: string, knowledgeIdValue: string, config: Partial<DialogueSessionConfig>) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const releases = await listReleases(courseId, knowledgeId);
  const payload = {
    ...normaliseConfig(config, releases),
    updatedAt: now()
  };
  await ensureDir(dialogueTestingDir(courseId, knowledgeId));
  await atomicWriteJson(sessionConfigPath(courseId, knowledgeId), payload);

  const existing = await getDialogueSession(courseId, knowledgeId);
  await saveDialogueSession(courseId, knowledgeId, {
    mode: existing.mode,
    config: payload,
    messages: existing.messages
  });
  return payload;
}

export async function saveDialogueRoutes(courseIdValue: string, knowledgeIdValue: string, routes: Partial<ChatRoute>[]) {
  return saveRouteConfig(courseIdValue, knowledgeIdValue, routes);
}

export async function getDialogueSession(courseIdValue: string, knowledgeIdValue: string): Promise<DialogueSession> {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const config = await getDialogueSessionConfig(courseId, knowledgeId);
  const stored = await readJson<Partial<DialogueSession> | null>(sessionPath(courseId, knowledgeId), null);
  return {
    mode: stored?.mode === "socratic" ? "socratic" : "lecture",
    config: stored?.config ? { ...config, ...normaliseConfig(stored.config, await listReleases(courseId, knowledgeId)) } : config,
    messages: normaliseMessages(stored?.messages),
    updatedAt: stored?.updatedAt || now()
  };
}

export async function saveDialogueSession(
  courseIdValue: string,
  knowledgeIdValue: string,
  session: Pick<DialogueSession, "mode" | "config" | "messages">
) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const payload: DialogueSession = {
    mode: session.mode === "socratic" ? "socratic" : "lecture",
    config: { ...session.config, updatedAt: session.config.updatedAt || now() },
    messages: normaliseMessages(session.messages),
    updatedAt: now()
  };
  await ensureDir(dialogueTestingDir(courseId, knowledgeId));
  await atomicWriteJson(sessionPath(courseId, knowledgeId), payload);
  return payload;
}

export async function getDialogueMultiSession(courseIdValue: string, knowledgeIdValue: string): Promise<DialogueMultiSession> {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  return readDialogueMultiSessionFromPath(sessionPath(courseId, knowledgeId));
}

async function readDialogueMultiSessionFromPath(filePath: string): Promise<DialogueMultiSession> {
  const stored = await readJson<Partial<DialogueMultiSession & DialogueSession> | null>(filePath, null);
  if (Array.isArray(stored?.sessions)) {
    return {
      mode: stored.mode === "socratic" ? "socratic" : "lecture",
      sessions: stored.sessions.map((session) => ({
        routeId: session.routeId,
        messages: normaliseMessages(session.messages),
        updatedAt: session.updatedAt || now()
      })).filter((session) => session.routeId),
      updatedAt: stored.updatedAt || now()
    };
  }
  return {
    mode: stored?.mode === "socratic" ? "socratic" : "lecture",
    sessions: stored?.messages?.length ? [{ routeId: "legacy", messages: normaliseMessages(stored.messages), updatedAt: stored.updatedAt || now() }] : [],
    updatedAt: stored?.updatedAt || now()
  };
}

async function saveDialogueRouteSessionToPath(
  filePath: string,
  modeValue: ChatMode,
  routeId: string,
  messages: DialogueMessage[]
) {
  const current = await readDialogueMultiSessionFromPath(filePath);
  const routeSession: DialogueRouteSession = {
    routeId,
    messages: normaliseMessages(messages),
    updatedAt: now()
  };
  const nextSessions = [
    ...current.sessions.filter((session) => session.routeId !== routeId && session.routeId !== "legacy"),
    routeSession
  ];
  const payload: DialogueMultiSession = {
    mode: modeValue === "socratic" ? "socratic" : "lecture",
    sessions: nextSessions,
    updatedAt: now()
  };
  await ensureDir(path.dirname(filePath));
  await atomicWriteJson(filePath, payload);
  return payload;
}

export async function saveDialogueRouteSession(
  courseIdValue: string,
  knowledgeIdValue: string,
  modeValue: ChatMode,
  routeId: string,
  messages: DialogueMessage[]
) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  return saveDialogueRouteSessionToPath(sessionPath(courseId, knowledgeId), modeValue, routeId, messages);
}

export async function getStandaloneDialogueSession(courseIdValue: string, knowledgeIdValue: string): Promise<DialogueMultiSession> {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  return readDialogueMultiSessionFromPath(dialogueSessionPath(courseId, knowledgeId));
}

export async function saveStandaloneDialogueRouteSession(
  courseIdValue: string,
  knowledgeIdValue: string,
  modeValue: ChatMode,
  routeId: string,
  messages: DialogueMessage[]
) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  return saveDialogueRouteSessionToPath(dialogueSessionPath(courseId, knowledgeId), modeValue, routeId, messages);
}

export async function resetDialogueSession(courseIdValue: string, knowledgeIdValue: string, mode?: ChatMode) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const current = await getDialogueMultiSession(courseId, knowledgeId);
  const payload: DialogueMultiSession = {
    mode: mode || current.mode,
    sessions: [],
    updatedAt: now()
  };
  await ensureDir(dialogueTestingDir(courseId, knowledgeId));
  await atomicWriteJson(sessionPath(courseId, knowledgeId), payload);
  return payload;
}

export async function resetStandaloneDialogueSession(courseIdValue: string, knowledgeIdValue: string, mode?: ChatMode) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const current = await getStandaloneDialogueSession(courseId, knowledgeId);
  const payload: DialogueMultiSession = {
    mode: mode || current.mode,
    sessions: [],
    updatedAt: now()
  };
  await ensureDir(dialogueDir(courseId, knowledgeId));
  await atomicWriteJson(dialogueSessionPath(courseId, knowledgeId), payload);
  return payload;
}

export async function getDialogueTestingState(courseIdValue: string, knowledgeIdValue: string) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const knowledge = await getKnowledge(courseId, knowledgeId);
  const [promptSettings, releases, session, routeConfig] = await Promise.all([
    getPromptSettings(courseId, knowledgeId),
    listReleases(courseId, knowledgeId),
    getDialogueMultiSession(courseId, knowledgeId),
    getRouteConfig(courseId, knowledgeId)
  ]);
  return {
    knowledgeTitle: knowledge?.title || knowledgeId,
    models: listConfiguredModels().map((model) => ({ ...model, label: displayModelLabel(model) })),
    releases,
    promptSettings,
    routeConfig,
    session
  };
}

export async function getDialogueState(courseIdValue: string, knowledgeIdValue: string) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const testingState = await getDialogueTestingState(courseId, knowledgeId);
  const standaloneSession = await getStandaloneDialogueSession(courseId, knowledgeId);
  const route = testingState.routeConfig.routes[0] || null;
  return {
    ...testingState,
    route,
    session: {
      mode: testingState.session.mode,
      messages: standaloneSession.sessions.find((session) => session.routeId === "primary")?.messages || []
    }
  };
}

function parseAssessmentJson(content: string) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error("Assessment returned invalid JSON.");
  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Assessment returned invalid JSON.");
  }
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Assessment JSON is missing ${field}.`);
  return value.trim();
}

function assessmentTextList(value: unknown, field: string, emptyFallback: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Assessment JSON must include text ${field} items.`);
  }
  const items = value.map((item) => (item as string).trim()).slice(0, 3);
  return items.length ? items : [emptyFallback];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`Assessment JSON has an invalid ${field}.`);
  return value as T;
}

function assessmentOperationForLegacyResult(value: Record<string, unknown>) {
  const operation = value.assessment_operation;
  if (typeof operation === "string") return oneOf(operation, ["probe", "diagnose_and_probe", "conclude", "redirect_then_probe"] as const, "assessment_operation");

  const quality = oneOf(value.overall_quality, ["strong", "mostly_good", "partial", "weak", "unclear"] as const, "overall_quality");
  if (quality === "unclear") return "probe";
  if (quality === "strong" || quality === "mostly_good") return "conclude";
  return "diagnose_and_probe";
}

function benchmarkBandForLegacyResult(value: Record<string, unknown>) {
  if (typeof value.benchmark_band === "string") {
    return oneOf(value.benchmark_band, ["Strong", "Partial", "Weak", "Not enough evidence"] as const, "benchmark_band");
  }
  const quality = oneOf(value.overall_quality, ["strong", "mostly_good", "partial", "weak", "unclear"] as const, "overall_quality");
  return quality === "strong" ? "Strong" : quality === "weak" ? "Weak" : quality === "unclear" ? "Not enough evidence" : "Partial";
}

function normaliseAssessmentResult(value: Record<string, unknown>, turnCount: number, selectionMethod: DialogueAssessmentResult["selection_method"]): DialogueAssessmentResult {
  const operation = assessmentOperationForLegacyResult(value);
  const nextQuestion = value.next_question === null ? null : requiredText(value.next_question, "next_question");
  if (operation === "conclude" ? nextQuestion !== null : !nextQuestion) {
    throw new Error("Assessment JSON has an invalid next_question for its assessment_operation.");
  }
  const learnerState = value.learner_state_update;
  if (!Array.isArray(learnerState) || learnerState.length < 1 || learnerState.length > 3) {
    throw new Error("Assessment JSON must include 1-3 learner_state_update items.");
  }

  return {
    assessment_type: oneOf(value.assessment_type, ["humanities_conversation_window_assessment"] as const, "assessment_type"),
    scope: oneOf(value.scope, ["selected_dialogue_window"] as const, "scope"),
    turn_count: turnCount,
    selection_method: selectionMethod,
    subject: oneOf(value.subject, ["philosophy", "literature", "history", "other_humanities"] as const, "subject"),
    topic: requiredText(value.topic, "topic"),
    overall_quality: oneOf(value.overall_quality, ["strong", "mostly_good", "partial", "weak", "unclear"] as const, "overall_quality"),
    benchmark_band: benchmarkBandForLegacyResult(value),
    student_understands: assessmentTextList(
      value.student_understands,
      "student_understands",
      "No clear understanding has been demonstrated in the selected dialogue yet."
    ),
    student_gaps: assessmentTextList(
      value.student_gaps,
      "student_gaps",
      "More student explanation is needed before the understanding can be assessed."
    ),
    diagnosis: requiredText(value.diagnosis, "diagnosis"),
    dominant_learning_need: requiredText(value.dominant_learning_need ?? value.recommended_tutor_move, "dominant_learning_need"),
    assessment_operation: operation,
    next_question: nextQuestion,
    learner_state_update: learnerState.map((item) => {
      if (!item || typeof item !== "object") throw new Error("Assessment JSON has an invalid learner_state_update item.");
      const entry = item as Record<string, unknown>;
      return {
        target: requiredText(entry.target, "learner_state_update.target"),
        status: oneOf(entry.status, ["stable", "partial", "weak", "misunderstood", "introduced", "unknown"] as const, "learner_state_update.status")
      };
    })
  };
}

export async function assessStandaloneDialogue(
  courseIdValue: string,
  knowledgeIdValue: string,
  startRoundValue: number,
  endRoundValue: number,
  selectionMethodValue: DialogueAssessmentResult["selection_method"]
) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const [course, knowledge, promptSettings, routeConfig, standaloneSession] = await Promise.all([
    getCourse(courseId),
    getKnowledge(courseId, knowledgeId),
    getPromptSettings(courseId, knowledgeId),
    getRouteConfig(courseId, knowledgeId),
    getStandaloneDialogueSession(courseId, knowledgeId)
  ]);
  if (!promptSettings.assessmentPrompt.trim()) throw new Error("Assessment Prompt is not configured for this Knowledge.");
  const route = routeConfig.routes[0];
  if (!route) throw new Error("No Dialogue Testing route is configured.");
  const messages = standaloneSession.sessions.find((session) => session.routeId === "primary")?.messages || [];
  const allRounds = completeDialogueRounds(messages);
  const startRound = Number.isInteger(startRoundValue) ? startRoundValue : -1;
  const endRound = Number.isInteger(endRoundValue) ? endRoundValue : -1;
  if (startRound < 0 || endRound < startRound || endRound >= allRounds.length) {
    throw new Error("Select at least one continuous dialogue round.");
  }
  const selectedRounds = allRounds.slice(startRound, endRound + 1);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter API key is missing. Please set OPENROUTER_API_KEY.");

  let knowledgeContext = "No KS Wiki context is enabled for the first Dialogue Testing route.";
  if (route.useKnowledge && route.releaseId) {
    knowledgeContext = `Current Knowledge Wiki release markdown:\n${(await downloadRelease(courseId, knowledgeId, route.releaseId)).content}`;
  }
  const selectionMethod = selectionMethodValue === "user_selected_turns" ? "user_selected_turns" : "default_latest_turns";
  const transcript = selectedRounds.map((round, offset) => [
    `Round ${offset + 1}`,
    `User: ${round.user.content}`,
    `AI Tutor: ${round.assistant.content}`
  ].join("\n")).join("\n\n");
  const assessmentContract = [
    "Return only valid JSON. Do not use Markdown fences or commentary.",
    "Your JSON must match the humanities conversation window assessment schema specified in the Assessment Prompt.",
    `Set turn_count to ${selectedRounds.length}.`,
    `Set selection_method to ${selectionMethod}.`,
    "student_understands, student_gaps, and learner_state_update must each contain 1-3 concise items.",
    "Even when evidence is insufficient, include one conservative item in student_understands and student_gaps; do not return empty arrays.",
    "When evidence is insufficient, use overall_quality unclear, benchmark_band Not enough evidence, and normally assessment_operation probe.",
    "For conclude, next_question may be null. For every other operation, provide exactly one useful next_question."
  ].join("\n");
  const systemPrompt = [
    promptSettings.assessmentPrompt,
    assessmentContract,
    `Course: ${course?.title || courseId}`,
    `Subject: ${course?.title || courseId}`,
    `Knowledge topic: ${knowledge?.title || knowledgeId}`,
    `Current knowledge release: ${route.releaseId || "None"}`,
    knowledgeContext
  ].join("\n\n");
  // Keep the same route model and OpenRouter transport as normal Dialogue.
  // Do not force a reasoning setting here: OpenRouter Auto can select models
  // that require reasoning and reject requests that explicitly disable it.
  const requestBody = {
    model: route.model,
    temperature: 0.2,
    max_tokens: 1600,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Assess this selected dialogue window.\n\nSelection method: ${selectionMethod}\nActual selected dialogue rounds: ${selectedRounds.length}\n\n${transcript}` }
    ]
  };
  const startedAt = now();
  let content = "";
  let httpStatus: number | undefined;
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(45000),
        headers: openRouterHeaders(apiKey),
        body: JSON.stringify(requestBody)
      });
      httpStatus = response.status;
      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(openRouterResponseError(responseText, response.status));
      }
      content = await collectOpenRouterStream(response);
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "OpenRouter did not respond.";
      if (attempt === 2) {
        await atomicWriteJson(dialogueAssessmentDebugPath(courseId, knowledgeId), {
          status: "error",
          startedAt,
          completedAt: now(),
          httpStatus,
          error: lastError,
          request: requestBody
        });
        throw new Error(`Assessment request failed: ${lastError}`);
      }
    }
  }
  let result: DialogueAssessmentResult;
  try {
    result = normaliseAssessmentResult(parseAssessmentJson(content), selectedRounds.length, selectionMethod);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assessment returned invalid JSON.";
    await atomicWriteJson(dialogueAssessmentDebugPath(courseId, knowledgeId), {
      status: "error",
      startedAt,
      completedAt: now(),
      error: message,
      request: requestBody,
      modelContent: content
    });
    throw new Error(message);
  }
  const record: DialogueAssessmentRecord = {
    id: `assessment_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    createdAt: now(),
    routeId: route.id,
    model: route.model,
    releaseId: route.releaseId,
    selectedRounds,
    result
  };
  const previous = await readJson<DialogueAssessmentRecord[]>(dialogueAssessmentPath(courseId, knowledgeId), []);
  await ensureDir(dialogueDir(courseId, knowledgeId));
  await atomicWriteJson(dialogueAssessmentPath(courseId, knowledgeId), [record, ...previous].slice(0, 50));
  await atomicWriteJson(dialogueAssessmentDebugPath(courseId, knowledgeId), {
    status: "success",
    startedAt,
    completedAt: now(),
    httpStatus,
    request: requestBody,
    response: result,
    assessmentId: record.id
  });
  return record;
}

function detectResponseLanguage(input: string) {
  const cjkCount = (input.match(/[\u3400-\u9fff]/g) || []).length;
  const latinCount = (input.match(/[A-Za-z]/g) || []).length;
  if (latinCount > 0 && latinCount >= cjkCount * 2) return "English";
  if (cjkCount > 0) return "Chinese";
  return "";
}

function languageGuard(input: string) {
  const language = detectResponseLanguage(input);
  if (!language) return "";
  return [
    "Response language rule for this turn:",
    `The latest student input language is ${language}.`,
    `Answer only in ${language}, regardless of the language used in internal course context, examples, or previous responses.`,
    "Do not translate the student's question unless they explicitly ask for translation."
  ].join("\n");
}

function buildSystemPrompt(prompts: PromptSettings, mode: ChatMode, knowledgeContext: string, latestInput: string) {
  const modePrompt = mode === "lecture" ? prompts.lecturePrompt : prompts.socraticPrompt;
  const finalPrompt = [prompts.basePrompt, modePrompt].filter(Boolean).join("\n\n");
  return [
    finalPrompt,
    knowledgeContext
      ? `Current Knowledge Wiki release markdown:\n${knowledgeContext}`
      : "No KS Wiki context is enabled for this dialogue session.",
    languageGuard(latestInput)
  ].filter(Boolean).join("\n\n");
}

function parseOpenRouterLines(lines: string[]) {
  let content = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as {
        choices?: { delta?: { content?: string }; message?: { content?: string }; error?: { message?: string }; finish_reason?: string }[];
      };
      const error = json.choices?.find((choice) => choice.error?.message)?.error?.message;
      if (error) throw new Error(`OpenRouter provider error: ${error}`);
      if (json.choices?.some((choice) => choice.finish_reason === "error")) {
        throw new Error("OpenRouter provider ended the response with an error.");
      }
      content += json.choices?.map((choice) => choice.delta?.content || choice.message?.content || "").join("") || "";
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("OpenRouter provider")) throw error;
      content += data;
    }
  }
  return content;
}

function openRouterHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_NAME || "Knowledge System"
  };
}

function openRouterResponseError(responseText: string, status: number) {
  try {
    const body = JSON.parse(responseText) as { error?: { message?: string } };
    return body.error?.message || responseText || `OpenRouter error ${status}`;
  } catch {
    return responseText || `OpenRouter error ${status}`;
  }
}

async function collectOpenRouterStream(response: Response) {
  if (!response.body) throw new Error("OpenRouter returned no response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  try {
    while (true) {
      const { done, value } = await readStreamWithTimeout(reader, content ? OPENROUTER_STREAM_IDLE_TIMEOUT_MS : OPENROUTER_FIRST_TOKEN_TIMEOUT_MS);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      content += parseOpenRouterLines(lines);
    }
    if (buffer) content += parseOpenRouterLines([buffer]);
    if (!content.trim()) throw new Error("OpenRouter returned an empty assessment response.");
    return content;
  } finally {
    reader.releaseLock();
  }
}

function openRouterFetchErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "OpenRouter did not respond.";
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  if (!cause || typeof cause !== "object") return message;

  const details: string[] = [];
  const record = cause as Record<string, unknown>;
  if (typeof record.code === "string") details.push(record.code);
  if (typeof record.reason === "string") details.push(record.reason);
  if (typeof record.hostname === "string") details.push(`hostname=${record.hostname}`);
  if (typeof record.host === "string") details.push(`host=${record.host}`);

  const cert = record.cert as Record<string, unknown> | undefined;
  if (cert && typeof cert.subjectaltname === "string") {
    details.push(`cert subjectAltName=${cert.subjectaltname}`);
  }

  return details.length ? `${message} (${details.join("; ")})` : message;
}

async function readStreamWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("OpenRouter stream timed out before returning content.")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function buildDialogueRequest(
  courseIdValue: string,
  knowledgeIdValue: string,
  modeValue: ChatMode,
  configInput: Partial<DialogueSessionConfig>,
  messagesInput: DialogueMessage[],
  input: string
) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Message is required.");

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter API key is missing. Please set OPENROUTER_API_KEY.");

  const releases = await listReleases(courseId, knowledgeId);
  const config = { ...normaliseConfig(configInput, releases), updatedAt: now() };
  let knowledgeContext = "";
  if (config.useKnowledge && config.releaseId) {
    knowledgeContext = (await downloadRelease(courseId, knowledgeId, config.releaseId)).content;
  }
  const prompts = await getPromptSettings(courseId, knowledgeId);
  const mode: ChatMode = modeValue === "socratic" ? "socratic" : "lecture";
  const fullHistory = normaliseMessages(messagesInput);
  const history = fullHistory.slice(-MAX_CONTEXT_MESSAGES);
  const userMessage: DialogueMessage = {
    id: messageId("user"),
    role: "user",
    content: trimmed,
    createdAt: now()
  };
  const openRouterMessages = [
    { role: "system", content: buildSystemPrompt(prompts, mode, knowledgeContext, trimmed) },
    ...history.map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: trimmed }
  ];
  const requestBody = {
    model: config.model,
    temperature: mode === "socratic" ? 0.55 : 0.35,
    max_tokens: 1400,
    stream: true,
    messages: openRouterMessages
  };

  const debugBase = {
    model: config.model,
    modelLabel: config.modelLabel,
    useKnowledge: config.useKnowledge,
    releaseId: config.releaseId,
    historyMessageCount: history.length,
    mode,
    createdAt: now()
  };

  return {
    apiKey,
    requestBody,
    debugBase,
    courseId,
    knowledgeId,
    mode,
    config,
    fullHistory,
    userMessage
  };
}

export async function streamDialogueMessage(
  courseIdValue: string,
  knowledgeIdValue: string,
  modeValue: ChatMode,
  configInput: Partial<DialogueSessionConfig>,
  messagesInput: DialogueMessage[],
  input: string,
  routeIdValue?: string,
  storage: "testing" | "dialogue" = "testing"
) {
  const {
    apiKey,
    requestBody,
    debugBase,
    courseId,
    knowledgeId,
    mode,
    config,
    fullHistory,
    userMessage
  } = await buildDialogueRequest(courseIdValue, knowledgeIdValue, modeValue, configInput, messagesInput, input);
  const routeId = routeIdValue || "default";
  const debugPath = storage === "dialogue" ? dialogueStandaloneDebugPath(courseId, knowledgeId) : dialogueDebugPath(courseId, knowledgeId);
  const saveSession = storage === "dialogue" ? saveStandaloneDialogueRouteSession : saveDialogueRouteSession;

  const startedAt = now();
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    const errorMessage = error instanceof Error && error.name === "TimeoutError"
      ? "OpenRouter did not respond before timeout."
      : openRouterFetchErrorMessage(error);
    await atomicWriteJson(debugPath, {
      ...debugBase,
      status: "error",
      error: errorMessage,
      startedAt,
      completedAt: now(),
      request: requestBody
    });
    throw new Error(`OpenRouter request failed: ${errorMessage}`);
  }

  if (!response.ok) {
    const text = await response.text();
    const errorMessage = openRouterResponseError(text, response.status);
    await atomicWriteJson(debugPath, {
      ...debugBase,
      status: "error",
      httpStatus: response.status,
      error: errorMessage,
      request: requestBody,
      response: text
    });
    throw new Error(`OpenRouter request failed: ${errorMessage}`);
  }
  if (!response.body) {
    const errorMessage = "OpenRouter returned no response stream.";
    await atomicWriteJson(debugPath, {
      ...debugBase,
      status: "error",
      httpStatus: response.status,
      error: errorMessage,
      request: requestBody
    });
    throw new Error(errorMessage);
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let answer = "";
  let buffer = "";
  const source = response.body.getReader();
  let firstChunk = "";
  try {
    while (!firstChunk) {
      const { done, value } = await readStreamWithTimeout(source, OPENROUTER_FIRST_TOKEN_TIMEOUT_MS);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      firstChunk = parseOpenRouterLines(lines);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "OpenRouter stream timed out before returning content.";
    await source.cancel().catch(() => undefined);
    await atomicWriteJson(debugPath, {
      ...debugBase,
      status: "error",
      httpStatus: response.status,
      error: errorMessage,
      startedAt,
      completedAt: now(),
      request: requestBody
    });
    throw new Error(`OpenRouter request failed: ${errorMessage}`);
  }
  if (!firstChunk) {
    const finalParsed = parseOpenRouterLines(buffer ? [buffer] : []);
    if (finalParsed) firstChunk = finalParsed;
  }
  if (!firstChunk) {
    const errorMessage = "OpenRouter returned an empty answer for this dialogue.";
    await atomicWriteJson(debugPath, {
      ...debugBase,
      status: "error",
      httpStatus: response.status,
      error: errorMessage,
      startedAt,
      completedAt: now(),
      request: requestBody
    });
    throw new Error(errorMessage);
  }

  answer = firstChunk;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(firstChunk));
      void (async () => {
        try {
          while (true) {
            const { done, value } = await readStreamWithTimeout(source, OPENROUTER_STREAM_IDLE_TIMEOUT_MS);
            if (done) {
              const finalParsed = parseOpenRouterLines(buffer ? [buffer] : []);
              if (finalParsed) {
                answer += finalParsed;
                controller.enqueue(encoder.encode(finalParsed));
              }
              const completedAt = now();
              const assistantMessage: DialogueMessage = {
                id: messageId("assistant"),
                role: "assistant",
                content: answer,
                createdAt: completedAt
              };
              await saveSession(courseId, knowledgeId, mode, routeId, [...fullHistory, userMessage, assistantMessage]);
              await atomicWriteJson(debugPath, {
                ...debugBase,
                status: "success",
                httpStatus: response.status,
                startedAt,
                completedAt,
                request: requestBody,
                answerPreview: answer.slice(0, 500)
              });
              controller.close();
              return;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";
            const parsed = parseOpenRouterLines(lines);
            if (parsed) {
              answer += parsed;
              controller.enqueue(encoder.encode(parsed));
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "OpenRouter stream failed.";
          await source.cancel().catch(() => undefined);
          await atomicWriteJson(debugPath, {
            ...debugBase,
            status: "error",
            httpStatus: response.status,
            error: errorMessage,
            startedAt,
            completedAt: now(),
            request: requestBody
          });
          controller.enqueue(encoder.encode(`${STREAM_ERROR_PREFIX}${errorMessage}`));
          controller.close();
        }
      })();
    },
    async cancel() {
      await source.cancel();
    }
  });

  return { stream, userMessage, config };
}

export { STREAM_ERROR_PREFIX as DIALOGUE_STREAM_ERROR_PREFIX };

export async function sendDialogueMessage(
  courseIdValue: string,
  knowledgeIdValue: string,
  modeValue: ChatMode,
  configInput: Partial<DialogueSessionConfig>,
  messagesInput: DialogueMessage[],
  input: string,
  routeIdValue?: string,
  storage: "testing" | "dialogue" = "testing"
) {
  const {
    apiKey,
    requestBody,
    debugBase,
    courseId,
    knowledgeId,
    mode,
    config,
    fullHistory,
    userMessage
  } = await buildDialogueRequest(courseIdValue, knowledgeIdValue, modeValue, configInput, messagesInput, input);
  const debugPath = storage === "dialogue" ? dialogueStandaloneDebugPath(courseId, knowledgeId) : dialogueDebugPath(courseId, knowledgeId);
  const saveSession = storage === "dialogue" ? saveStandaloneDialogueRouteSession : saveDialogueRouteSession;
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
        "X-Title": process.env.OPENROUTER_APP_NAME || "Knowledge System"
      },
      body: JSON.stringify({ ...requestBody, stream: false })
    });
  } catch (error) {
    const errorMessage = openRouterFetchErrorMessage(error);
    await atomicWriteJson(debugPath, {
      ...debugBase,
      status: "error",
      error: errorMessage,
      request: { ...requestBody, stream: false }
    });
    throw new Error(`OpenRouter request failed: ${errorMessage}`);
  }
  const responseText = await response.text();
  let data: { choices?: { message?: { content?: string } }[]; error?: { message?: string } } = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const errorMessage = data.error?.message || responseText || `OpenRouter error ${response.status}`;
    await atomicWriteJson(debugPath, {
      ...debugBase,
      status: "error",
      httpStatus: response.status,
      error: errorMessage,
      request: { ...requestBody, stream: false },
      response: data.error || responseText
    });
    throw new Error(`OpenRouter request failed: ${errorMessage}`);
  }

  const answer = data.choices?.[0]?.message?.content?.trim() || "";
  if (!answer) {
    const errorMessage = "OpenRouter returned an empty answer for this dialogue.";
    await atomicWriteJson(debugPath, {
      ...debugBase,
      status: "error",
      httpStatus: response.status,
      error: errorMessage,
      request: { ...requestBody, stream: false },
      response: data || responseText
    });
    throw new Error(errorMessage);
  }

  const assistantMessage: DialogueMessage = {
    id: messageId("assistant"),
    role: "assistant",
    content: answer,
    createdAt: now()
  };
  const session = await saveSession(courseId, knowledgeId, mode, routeIdValue || "default", [...fullHistory, userMessage, assistantMessage]);
  await atomicWriteJson(debugPath, {
    ...debugBase,
    status: "success",
    httpStatus: response.status,
    request: { ...requestBody, stream: false },
    answerPreview: answer.slice(0, 500)
  });
  return { userMessage, message: assistantMessage, session };
}
