export type TutorKeyOutcome = "ok" | "failed" | "rate_limited" | "quota";

export type TutorKeyCall = (secret: string) => Promise<{ outcome: TutorKeyOutcome; latencyMs: number; body?: string }>;

type KeyState = {
  id: string;
  secret: string;
  requests: number;
  errors: number;
  latencyMs: number;
  healthy: boolean;
};

export function createTutorKeyPool(input: { keys: Array<{ id: string; secret: string }>; call: TutorKeyCall }) {
  const states: KeyState[] = input.keys.map((key) => ({
    id: key.id,
    secret: key.secret,
    requests: 0,
    errors: 0,
    latencyMs: 0,
    healthy: true
  }));

  return {
    async execute(text: string, call: TutorKeyCall = input.call) {
      void text;
      for (const state of states) {
        if (!state.healthy) continue;
        state.requests += 1;
        const result = await call(state.secret);
        state.latencyMs += result.latencyMs;
        if (result.outcome !== "ok") {
          state.errors += 1;
          if (result.outcome !== "failed") state.healthy = false;
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
