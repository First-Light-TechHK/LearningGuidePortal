export type TutorKeyOutcome = "ok" | "failed" | "auth_failed" | "rate_limited" | "quota";

// `timeoutMs`, when given, is how long this one call may take: what is left
// of the caller's deadline.
export type TutorKeyCall = (secret: string, timeoutMs?: number) => Promise<{ outcome: TutorKeyOutcome; latencyMs: number; body?: string }>;

// Bug hunt 2026-10-14 (M4): a rate limit or a spent quota is a transient
// provider state, not a verdict on the key. The pool used to mark such a key
// permanently unhealthy for the life of the process, so a single 429 could
// leave the environment without an AI Tutor until a restart. Limited keys now
// rest for a cooldown and are retried; a quota is expected to relax on a
// longer horizon than a rate-limit window. An authenticated rejection stays
// permanent: the key is wrong, not busy.
export const TUTOR_KEY_COOLDOWN_MS: Record<"rate_limited" | "quota", number> = {
  rate_limited: 60_000,
  quota: 300_000
};

type KeyState = {
  id: string;
  secret: string;
  requests: number;
  errors: number;
  latencyMs: number;
  // Epoch milliseconds until which the key must not be attempted. 0 means
  // available; Infinity means permanently out (auth_failed).
  disabledUntil: number;
};

export function createTutorKeyPool(input: { keys: Array<{ id: string; secret: string }>; call: TutorKeyCall; now?: () => number }) {
  const now = input.now ?? Date.now;
  const states: KeyState[] = input.keys.map((key) => ({
    id: key.id,
    secret: key.secret,
    requests: 0,
    errors: 0,
    latencyMs: 0,
    disabledUntil: 0
  }));

  return {
    // `deadline` (epoch milliseconds) bounds the whole answer, every key
    // included: no key is tried after it, and each call gets only the time
    // left (QA r3 server 5), so one question never outlives its claim lease.
    async execute(text: string, call: TutorKeyCall = input.call, options: { deadline?: number } = {}) {
      void text;
      for (const state of states) {
        if (state.disabledUntil > now()) continue;
        const left = options.deadline === undefined ? undefined : options.deadline - now();
        if (left !== undefined && left <= 0) break;
        state.requests += 1;
        const result = await call(state.secret, left);
        state.latencyMs += result.latencyMs;
        if (result.outcome !== "ok") {
          state.errors += 1;
          if (result.outcome === "auth_failed") state.disabledUntil = Number.POSITIVE_INFINITY;
          // "failed" (network-class) stays available: the request itself is
          // retried against the same key on the next call, as before.
          else if (result.outcome !== "failed") state.disabledUntil = now() + TUTOR_KEY_COOLDOWN_MS[result.outcome];
          continue;
        }
        return { keyId: state.id, body: result.body ?? "", log: `key ${state.id} ok` };
      }
      return { keyId: "", body: "", log: "no healthy key" };
    },
    stats() {
      return Object.fromEntries(states.map((state) => [state.id, { requests: state.requests, errors: state.errors, latencyMs: state.latencyMs }]));
    }
  };
}
