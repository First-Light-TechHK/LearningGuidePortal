import { setDefaultResultOrder } from "dns";

try {
  setDefaultResultOrder("ipv4first");
} catch {
  // Node may reject this on some platforms; retries still apply.
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const RETRYABLE = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT"
]);

export function openRouterErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "OpenRouter did not respond.";
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  if (!cause || typeof cause !== "object") return message;
  const record = cause as Record<string, unknown>;
  const details: string[] = [];
  if (typeof record.code === "string") details.push(record.code);
  if (typeof record.reason === "string") details.push(record.reason);
  if (typeof record.hostname === "string") details.push(`hostname=${record.hostname}`);
  if (typeof record.host === "string") details.push(`host=${record.host}`);
  return details.length ? `${message} (${details.join("; ")})` : message;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  const cause = record.cause;
  if (cause && typeof cause === "object" && typeof (cause as { code?: unknown }).code === "string") {
    return (cause as { code: string }).code;
  }
  return "";
}

function isRetryable(error: unknown) {
  const code = errorCode(error);
  if (RETRYABLE.has(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNRESET|socket hang up|network/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGeminiModel(model: unknown) {
  return typeof model === "string" && /^google\/gemini-/i.test(model);
}

function withOpenRouterDefaults(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { payload: body, injectedReasoning: false };
  }
  const record = { ...(body as Record<string, unknown>) };
  const existing = record.provider && typeof record.provider === "object" && !Array.isArray(record.provider)
    ? { ...(record.provider as Record<string, unknown>) }
    : {};
  if (existing.sort == null) existing.sort = "throughput";
  if (existing.preferred_min_throughput == null) existing.preferred_min_throughput = 20;
  record.provider = existing;
  let injectedReasoning = false;
  if (record.reasoning == null && !isGeminiModel(record.model)) {
    record.reasoning = { effort: "none", exclude: true };
    injectedReasoning = true;
  }
  return { payload: record, injectedReasoning };
}

async function postOpenRouter(apiKey: string, payload: unknown, signal: AbortSignal) {
  return fetch(OPENROUTER_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Connection: "close",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://127.0.0.1:3007",
      "X-Title": process.env.OPENROUTER_APP_NAME || "Knowledge System"
    },
    body: JSON.stringify(payload)
  });
}

async function fetchOnce(apiKey: string, body: unknown, timeoutMs: number) {
  const { payload, injectedReasoning } = withOpenRouterDefaults(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let rejectDeadline: ((error: Error) => void) | undefined;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const deadlineTimer = setTimeout(() => {
    const error = new Error(`OpenRouter request timed out after ${timeoutMs}ms.`) as Error & { code?: string };
    error.code = "ETIMEDOUT";
    rejectDeadline?.(error);
  }, timeoutMs);
  const request = (async () => {
    let response = await postOpenRouter(apiKey, payload, controller.signal);
    if (response.status === 400 && injectedReasoning && payload && typeof payload === "object") {
      const text = await response.text();
      if (/reasoning/i.test(text)) {
        const { reasoning: _ignored, ...withoutReasoning } = payload as Record<string, unknown>;
        return postOpenRouter(apiKey, withoutReasoning, controller.signal);
      }
      return new Response(text, { status: 400, headers: response.headers });
    }
    return response;
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
    clearTimeout(deadlineTimer);
    controller.abort();
  }
}

export async function fetchOpenRouter(
  apiKey: string,
  body: unknown,
  options?: { timeoutMs?: number; attempts?: number }
) {
  const timeoutMs = options?.timeoutMs ?? 45000;
  const attempts = options?.attempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchOnce(apiKey, body, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryable(error)) throw error;
      await sleep(400 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenRouter request failed.");
}
