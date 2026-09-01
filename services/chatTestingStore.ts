import { readFile } from "fs/promises";
import path from "path";
import { atomicWriteJson, ensureDir, now, readJson, safeSegment } from "./fileStore";
import { getKnowledge, knowledgeDir } from "./knowledgeStore";
import { downloadRelease, listReleases } from "./releaseStore";
import { DEFAULT_MODEL_ID, displayModelLabel, findConfiguredModel, listConfiguredModels } from "./modelStore";
import { fetchOpenRouter } from "./openRouterClient";
import { SCIENCE_DISPLAY_CONTRACT, isScienceFieldCourse } from "./scienceTopics";

export type ChatMode = "lecture" | "socratic";
export type ChatRouteStatus = "pending" | "loading" | "streaming" | "done" | "error";
const STREAM_ERROR_PREFIX = "__CHAT_TESTING_ROUTE_ERROR__:";
const OPENROUTER_FIRST_TOKEN_TIMEOUT_MS = 20000;
const OPENROUTER_STREAM_IDLE_TIMEOUT_MS = 15000;

export type PromptSettings = {
  basePrompt: string;
  lecturePrompt: string;
  socraticPrompt: string;
  assessmentPrompt: string;
  updatedAt: string;
};

export type ChatRoute = {
  id: string;
  model: string;
  modelLabel: string;
  useKnowledge: boolean;
  releaseId: string | null;
};

export type RouteConfig = {
  routes: ChatRoute[];
  updatedAt: string;
};

export type ChatResult = {
  routeId: string;
  model: string;
  modelLabel: string;
  releaseId: string | null;
  useKnowledge: boolean;
  question?: string;
  answer: string;
  error?: string;
  status?: ChatRouteStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type LastRun = {
  question: string;
  mode: ChatMode;
  results: ChatResult[];
  updatedAt: string;
};

function chatTestingDir(courseId: string, knowledgeId: string) {
  return path.join(knowledgeDir(courseId, knowledgeId), "chat_testing");
}

function promptSettingsPath(courseId: string, knowledgeId: string) {
  return path.join(chatTestingDir(courseId, knowledgeId), "prompt_settings.json");
}

function routeConfigPath(courseId: string, knowledgeId: string) {
  return path.join(chatTestingDir(courseId, knowledgeId), "route_config.json");
}

function lastRunPath(courseId: string, knowledgeId: string) {
  return path.join(chatTestingDir(courseId, knowledgeId), "last_run.json");
}

function routeDebugPath(courseId: string, knowledgeId: string, routeIdValue: string) {
  return path.join(chatTestingDir(courseId, knowledgeId), "debug", `${safeSegment(routeIdValue)}.json`);
}

async function readPromptDefault(name: string) {
  try {
    return await readFile(path.join(process.cwd(), "prompts", "chat_testing", name), "utf8");
  } catch {
    return "";
  }
}

function routeId() {
  return `route_${Math.random().toString(16).slice(2, 10)}`;
}

async function defaultPrompts(): Promise<PromptSettings> {
  return {
    basePrompt: await readPromptDefault("BasePrompt"),
    lecturePrompt: await readPromptDefault("LecturePrompt"),
    socraticPrompt: await readPromptDefault("SocraticPrompt"),
    assessmentPrompt: await readPromptDefault("AssessmentPrompt"),
    updatedAt: now()
  };
}

function promptOrDefault(value: string | undefined, fallback: string) {
  return value?.trim() ? value : fallback;
}

async function defaultRouteConfig(courseId: string, knowledgeId: string): Promise<RouteConfig> {
  const releases = await listReleases(courseId, knowledgeId);
  const latest = releases[0]?.id || null;
  const model = findConfiguredModel(DEFAULT_MODEL_ID)!;
  return {
    routes: [
      {
        id: routeId(),
        model: DEFAULT_MODEL_ID,
        modelLabel: displayModelLabel(model),
        useKnowledge: Boolean(latest),
        releaseId: latest
      }
    ],
    updatedAt: now()
  };
}

function normaliseRoute(route: Partial<ChatRoute>, releases: { id: string }[]): ChatRoute {
  const model = findConfiguredModel(route.model || DEFAULT_MODEL_ID) || findConfiguredModel(DEFAULT_MODEL_ID)!;
  const releaseExists = releases.some((release) => release.id === route.releaseId);
  const useKnowledge = Boolean(route.useKnowledge && route.releaseId && releaseExists);
  return {
    id: route.id || routeId(),
    model: model.id,
    modelLabel: displayModelLabel(model),
    useKnowledge,
    releaseId: useKnowledge ? route.releaseId! : null
  };
}

export async function getPromptSettings(courseIdValue: string, knowledgeIdValue: string) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const defaults = await defaultPrompts();
  const stored = await readJson<PromptSettings | null>(promptSettingsPath(courseId, knowledgeId), null);
  if (!stored) return defaults;
  const hasSavedPrompt = [
    stored.basePrompt,
    stored.lecturePrompt,
    stored.socraticPrompt,
    stored.assessmentPrompt
  ].some((value) => value?.trim());
  if (!hasSavedPrompt) return defaults;
  return {
    basePrompt: promptOrDefault(stored.basePrompt, defaults.basePrompt),
    lecturePrompt: promptOrDefault(stored.lecturePrompt, defaults.lecturePrompt),
    socraticPrompt: promptOrDefault(stored.socraticPrompt, defaults.socraticPrompt),
    assessmentPrompt: promptOrDefault(stored.assessmentPrompt, defaults.assessmentPrompt),
    updatedAt: stored.updatedAt || defaults.updatedAt
  };
}

export async function savePromptSettings(courseIdValue: string, knowledgeIdValue: string, settings: Partial<PromptSettings>) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const payload: PromptSettings = {
    basePrompt: settings.basePrompt || "",
    lecturePrompt: settings.lecturePrompt || "",
    socraticPrompt: settings.socraticPrompt || "",
    assessmentPrompt: settings.assessmentPrompt || "",
    updatedAt: now()
  };
  await ensureDir(chatTestingDir(courseId, knowledgeId));
  await atomicWriteJson(promptSettingsPath(courseId, knowledgeId), payload);
  return payload;
}

export async function getRouteConfig(courseIdValue: string, knowledgeIdValue: string) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const releases = await listReleases(courseId, knowledgeId);
  const stored = await readJson<RouteConfig | null>(routeConfigPath(courseId, knowledgeId), null);
  if (!stored?.routes?.length) return defaultRouteConfig(courseId, knowledgeId);
  return {
    routes: stored.routes.slice(0, 3).map((route) => normaliseRoute(route, releases)),
    updatedAt: stored.updatedAt || now()
  };
}

export async function saveRouteConfig(courseIdValue: string, knowledgeIdValue: string, routes: Partial<ChatRoute>[]) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const releases = await listReleases(courseId, knowledgeId);
  const normalised = routes.slice(0, 3).map((route) => normaliseRoute(route, releases));
  const fallback = normalised.length ? normalised : (await defaultRouteConfig(courseId, knowledgeId)).routes;
  const payload = { routes: fallback, updatedAt: now() };
  await ensureDir(chatTestingDir(courseId, knowledgeId));
  await atomicWriteJson(routeConfigPath(courseId, knowledgeId), payload);
  return payload;
}

export async function getLastRun(courseIdValue: string, knowledgeIdValue: string) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  return readJson<LastRun | null>(lastRunPath(courseId, knowledgeId), null);
}

export async function getChatTestingState(courseIdValue: string, knowledgeIdValue: string) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const knowledge = await getKnowledge(courseId, knowledgeId);
  const [promptSettings, routeConfig, releases, lastRun] = await Promise.all([
    getPromptSettings(courseId, knowledgeId),
    getRouteConfig(courseId, knowledgeId),
    listReleases(courseId, knowledgeId),
    getLastRun(courseId, knowledgeId)
  ]);
  return {
    knowledgeTitle: knowledge?.title || knowledgeId,
    models: listConfiguredModels().map((model) => ({ ...model, label: displayModelLabel(model) })),
    releases,
    promptSettings,
    routeConfig,
    lastRun
  };
}

async function buildRouteRequest(courseId: string, knowledgeId: string, question: string, mode: ChatMode, prompts: PromptSettings, route: ChatRoute, stream = false) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter API key is missing. Please set OPENROUTER_API_KEY.");
  let knowledgeContext = "";
  if (route.useKnowledge && route.releaseId) {
    knowledgeContext = (await downloadRelease(courseId, knowledgeId, route.releaseId)).content;
  }
  const modePrompt = mode === "lecture" ? prompts.lecturePrompt : prompts.socraticPrompt;
  const finalPrompt = [
    prompts.basePrompt,
    modePrompt
  ].filter(Boolean).join("\n\n");
  const systemPrompt = [
    finalPrompt,
    isScienceFieldCourse(courseId) ? SCIENCE_DISPLAY_CONTRACT : "",
    knowledgeContext
      ? `Current Knowledge Wiki release markdown:\n${knowledgeContext}`
      : "No Knowledge Wiki release is available for this route."
  ].filter(Boolean).join("\n\n");
  const requestBody = {
    model: route.model,
    temperature: mode === "socratic" ? 0.55 : 0.35,
    max_tokens: 1400,
    stream,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question }
    ]
  };
  const debugBase = {
    routeId: route.id,
    model: route.model,
    modelLabel: route.modelLabel,
    useKnowledge: route.useKnowledge,
    releaseId: route.releaseId,
    question,
    mode,
    createdAt: now()
  };
  return { apiKey, requestBody, debugBase };
}

function parseOpenRouterLines(lines: string[]) {
  let content = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as { choices?: { delta?: { content?: string }; message?: { content?: string } }[] };
      content += json.choices?.map((choice) => choice.delta?.content || choice.message?.content || "").join("") || "";
    } catch {
      content += data;
    }
  }
  return content;
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

async function runOneRoute(courseId: string, knowledgeId: string, question: string, mode: ChatMode, prompts: PromptSettings, route: ChatRoute): Promise<ChatResult> {
  const { apiKey, requestBody, debugBase } = await buildRouteRequest(courseId, knowledgeId, question, mode, prompts, route);

  const response = await fetchOpenRouter(apiKey, requestBody, { timeoutMs: 45000 });
  const responseText = await response.text();
  let data: { choices?: { message?: { content?: string } }[]; error?: { message?: string; code?: string | number } } = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const errorMessage = data.error?.message || responseText || `OpenRouter error ${response.status}`;
    await atomicWriteJson(routeDebugPath(courseId, knowledgeId, route.id), {
      ...debugBase,
      status: "error",
      httpStatus: response.status,
      error: errorMessage,
      request: requestBody,
      response: data.error || responseText
    });
    throw new Error(`OpenRouter request failed: ${errorMessage}`);
  }
  const answer = data.choices?.[0]?.message?.content?.trim() || "";
  if (!answer) {
    const errorMessage = "OpenRouter returned an empty answer for this route.";
    await atomicWriteJson(routeDebugPath(courseId, knowledgeId, route.id), {
      ...debugBase,
      status: "error",
      httpStatus: response.status,
      error: errorMessage,
      request: requestBody,
      response: data || responseText
    });
    throw new Error(errorMessage);
  }
  await atomicWriteJson(routeDebugPath(courseId, knowledgeId, route.id), {
    ...debugBase,
    status: "success",
    httpStatus: response.status,
    request: requestBody,
    answerPreview: answer.slice(0, 500)
  });
  return {
    routeId: route.id,
    model: route.model,
    modelLabel: route.modelLabel,
    releaseId: route.releaseId,
    useKnowledge: route.useKnowledge,
    question,
    answer,
    status: "done",
    createdAt: now()
  };
}

export async function runChatTesting(courseIdValue: string, knowledgeIdValue: string, question: string, mode: ChatMode, routes: Partial<ChatRoute>[]) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const prompts = await getPromptSettings(courseId, knowledgeId);
  const routeConfig = await saveRouteConfig(courseId, knowledgeId, routes);
  const results: ChatResult[] = [];
  for (const route of routeConfig.routes) {
    try {
      results.push(await runOneRoute(courseId, knowledgeId, question, mode, prompts, route));
    } catch (error) {
      const debugPath = routeDebugPath(courseId, knowledgeId, route.id);
      const existingDebug = await readJson<unknown | null>(debugPath, null);
      if (!existingDebug) {
        await atomicWriteJson(debugPath, {
          routeId: route.id,
          model: route.model,
          modelLabel: route.modelLabel,
          useKnowledge: route.useKnowledge,
          releaseId: route.releaseId,
          question,
          mode,
          status: "error",
          error: error instanceof Error ? error.message : "Route failed.",
          createdAt: now()
        });
      }
      results.push({
        routeId: route.id,
        model: route.model,
        modelLabel: route.modelLabel,
        releaseId: route.releaseId,
        useKnowledge: route.useKnowledge,
        question,
        answer: "",
        error: error instanceof Error ? error.message : "Route failed.",
        status: "error",
        createdAt: now()
      });
    }
  }
  const payload = { question, mode, results, updatedAt: now() };
  await ensureDir(chatTestingDir(courseId, knowledgeId));
  await atomicWriteJson(lastRunPath(courseId, knowledgeId), payload);
  return { results };
}

export async function streamChatTestingRoute(
  courseIdValue: string,
  knowledgeIdValue: string,
  question: string,
  mode: ChatMode,
  routeInput: Partial<ChatRoute>
) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const prompts = await getPromptSettings(courseId, knowledgeId);
  const releases = await listReleases(courseId, knowledgeId);
  const route = normaliseRoute(routeInput, releases);
  const { apiKey, requestBody, debugBase } = await buildRouteRequest(courseId, knowledgeId, question, mode, prompts, route, true);
  const startedAt = now();
  let response: Response;
  try {
    response = await fetchOpenRouter(apiKey, requestBody, { timeoutMs: 45000 });
  } catch (error) {
    const errorMessage = error instanceof Error && error.name === "TimeoutError"
      ? "OpenRouter did not respond before timeout."
      : error instanceof Error ? error.message : "OpenRouter did not respond.";
    await atomicWriteJson(routeDebugPath(courseId, knowledgeId, route.id), {
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
    let errorMessage = text || `OpenRouter error ${response.status}`;
    try {
      const json = JSON.parse(text) as { error?: { message?: string } };
      errorMessage = json.error?.message || errorMessage;
    } catch {
      // Keep the raw OpenRouter body.
    }
    await atomicWriteJson(routeDebugPath(courseId, knowledgeId, route.id), {
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
    await atomicWriteJson(routeDebugPath(courseId, knowledgeId, route.id), {
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
    await atomicWriteJson(routeDebugPath(courseId, knowledgeId, route.id), {
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
    const errorMessage = "OpenRouter returned an empty answer for this route.";
    await atomicWriteJson(routeDebugPath(courseId, knowledgeId, route.id), {
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
              await atomicWriteJson(routeDebugPath(courseId, knowledgeId, route.id), {
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
          await atomicWriteJson(routeDebugPath(courseId, knowledgeId, route.id), {
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
  return { stream, route };
}

export async function saveChatTestingRun(
  courseIdValue: string,
  knowledgeIdValue: string,
  question: string,
  mode: ChatMode,
  results: ChatResult[]
) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const payload = { question, mode, results, updatedAt: now() };
  await ensureDir(chatTestingDir(courseId, knowledgeId));
  await atomicWriteJson(lastRunPath(courseId, knowledgeId), payload);
  return payload;
}
