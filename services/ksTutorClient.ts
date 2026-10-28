import type { Locale } from "@/lib/i18n/config";

/** KS 学员侧可见的 AI Tutor 状态（无缓存，保证 Online 开关立即生效） */
export type TutorAvailability = {
  /** 有效可用性：KS 返回 available = online && 有上线 Release */
  online: boolean;
  /** false = KS 未配置 / 不可达；Portal 按 offline 处理并隐藏入口 */
  reachable: boolean;
};

export type TutorHistoryMessage = { role: "user" | "assistant"; content: string };

/** KS 课程 AI Tutor 欢迎语（2026-10-27：课程级统一，不再按模式区分；空字符串表示未配置） */
export type TutorWelcome = { welcome: string };

export class KsTutorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "KsTutorError";
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 2_500;

function config() {
  const baseUrl = process.env.KS_TUTOR_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.KS_TUTOR_API_KEY?.trim();
  const timeoutMs = Number(process.env.KS_TUTOR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return {
    baseUrl,
    apiKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

function signalWithTimeout(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

function ksMode(mode: "lecture" | "socratic") {
  return mode === "socratic" ? "SOCRATIC" : "LECTURE";
}

/**
 * 读取某 Portal 课程（slug）的 AI Tutor 状态。
 * KS 不可达或未配置时返回 reachable=false，调用方应按 offline 隐藏入口。
 */
export async function getTutorAvailability(
  externalCourseId: string,
  signal?: AbortSignal,
): Promise<TutorAvailability> {
  const { baseUrl, apiKey } = config();
  if (!baseUrl) {
    return { online: false, reachable: false };
  }

  const timeout = signalWithTimeout(signal, STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/api/user/ai-tutors`, {
      headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      cache: "no-store",
      signal: timeout.signal,
    });
    if (!response.ok) {
      return { online: false, reachable: false };
    }
    const payload = (await response.json()) as {
      data?: Array<{ externalId?: string; available?: boolean }>;
    };
    const tutor = payload.data?.find((item) => item.externalId === externalCourseId);
    return { online: Boolean(tutor?.available), reachable: true };
  } catch {
    return { online: false, reachable: false };
  } finally {
    timeout.dispose();
  }
}

/**
 * 读取某 Portal 课程（slug）的欢迎语（2026-10-27：课程级统一，不再按模式区分）。
 * KS 不可达/未配置时返回空字符串，前端据此不展示欢迎气泡（不编造本地文案）。
 */
export async function getTutorWelcome(
  externalCourseId: string,
  locale: Locale,
  signal?: AbortSignal,
): Promise<TutorWelcome> {
  const empty: TutorWelcome = { welcome: "" };
  const { baseUrl, apiKey } = config();
  if (!baseUrl) return empty;

  const timeout = signalWithTimeout(signal, STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/api/user/ai-tutors/${encodeURIComponent(externalCourseId)}/welcome?locale=${encodeURIComponent(locale)}`, {
      headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      cache: "no-store",
      signal: timeout.signal,
    });
    if (!response.ok) return empty;
    const payload = (await response.json()) as {
      data?: { welcome?: unknown };
    };
    return {
      welcome: typeof payload.data?.welcome === "string" ? payload.data.welcome : "",
    };
  } catch {
    return empty;
  } finally {
    timeout.dispose();
  }
}

/**
 * 调用 KS 学员端 SSE 接口，并把 `{delta}` 帧还原成纯文本增量。
 * Portal 前端保持现有 text/plain 协议，不感知 KS 的 SSE 格式。
 */
export async function* streamTutorText(input: {
  externalCourseId: string;
  message: string;
  mode: "lecture" | "socratic";
  locale: Locale;
  history: TutorHistoryMessage[];
  signal?: AbortSignal;
  // KS quota bucket: the learning page's 1:1 Tutor ("portal", the default)
  // and the Live Session room ("study-group") never spend each other's budget.
  channel?: "portal" | "study-group";
}): AsyncGenerator<string> {
  const { baseUrl, apiKey, timeoutMs } = config();
  if (!baseUrl) {
    throw new KsTutorError("AI Tutor service is not configured.", 503, "KS_TUTOR_NOT_CONFIGURED");
  }

  const timeout = signalWithTimeout(input.signal, timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/user/ai/chat-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
      cache: "no-store",
      signal: timeout.signal,
      body: JSON.stringify({
        externalCourseId: input.externalCourseId,
        message: input.message,
        mode: ksMode(input.mode),
        locale: input.locale,
        history: input.history.slice(-10),
        channel: input.channel ?? "portal"
      }),
    });
  } catch (error) {
    timeout.dispose();
    throw new KsTutorError(
      error instanceof Error ? error.message : "AI Tutor service is unavailable.",
      503,
      "KS_TUTOR_UNAVAILABLE",
    );
  }

  if (!response.ok) {
    const { code, message } = await readError(response);
    timeout.dispose();
    throw new KsTutorError(message, response.status, code);
  }
  if (!response.body) {
    timeout.dispose();
    throw new KsTutorError("AI Tutor returned no response stream.", 502, "KS_TUTOR_EMPTY_STREAM");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  try {
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          const event = JSON.parse(raw) as { delta?: unknown; done?: unknown; error?: unknown };
          if (typeof event.error === "string" && event.error) {
            throw new KsTutorError(event.error, 502, "KS_TUTOR_STREAM_ERROR");
          }
          if (typeof event.delta === "string" && event.delta) yield event.delta;
          if (event.done === true) {
            done = true;
            break;
          }
        }
        if (done) break;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    timeout.dispose();
    await reader.cancel().catch(() => undefined);
  }
}

async function readError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const payload = (await response.json()) as {
      code?: string;
      message?: string;
      error?: { code?: string; message?: string };
    };
    return {
      code: payload.error?.code || payload.code || `KS_HTTP_${response.status}`,
      message: payload.error?.message || payload.message || `AI Tutor returned HTTP ${response.status}.`,
    };
  } catch {
    return {
      code: `KS_HTTP_${response.status}`,
      message: `AI Tutor returned HTTP ${response.status}.`,
    };
  }
}
