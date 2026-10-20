import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { readTutorKeys, studyGroupTutorKeys } from "@/modules/group-study/tutorAnswer";

type SecretValueReader = {
  getSecretValue(secretId: string): Promise<string | undefined>;
};

export type TutorKey = { id: string; secret: string };
export type TutorKeyReadOptions = Readonly<{ forceRefresh?: boolean }>;

// The Live Session tutor's keys, hot: with STUDY_GROUP_TUTOR_KEYS_SECRET_ID set
// the pool is read from that Secrets Manager secret at run time and re-read
// at most once a minute, so adding, removing or rotating a key needs no
// redeploy (the LiveKit credentials work the same way, liveKitCredentials.ts).
// A failed or empty read keeps the last good pool; with none yet, the
// environment pool (STUDY_GROUP_TUTOR_KEYS, then the site's OpenRouter key,
// see studyGroupTutorKeys) answers instead. `forceRefresh` re-reads at once:
// the drain asks for it when every key it had was refused.
export function createTutorKeySource(input: {
  reader: SecretValueReader | null;
  secretId?: string;
  env: Record<string, string | undefined>;
  now?: () => number;
  cacheTtlMs?: number;
}) {
  const now = input.now ?? Date.now;
  const cacheTtlMs = input.cacheTtlMs ?? 60_000;
  const secretId = input.secretId?.trim() || "";
  let cached: { keys: TutorKey[]; at: number } | null = null;
  let inFlight: Promise<TutorKey[]> | null = null;

  async function readSecret() {
    try {
      const keys = readTutorKeys(await input.reader!.getSecretValue(secretId));
      if (keys.length > 0) cached = { keys, at: now() };
      else if (cached) cached = { keys: cached.keys, at: now() };
    } catch {
      // Keep the last good pool; the next read after the TTL tries again.
      if (cached) cached = { keys: cached.keys, at: now() };
    }
    return cached?.keys ?? studyGroupTutorKeys(input.env);
  }

  return {
    async keys(options: TutorKeyReadOptions = {}): Promise<TutorKey[]> {
      if (!secretId || !input.reader) return studyGroupTutorKeys(input.env);
      if (!options.forceRefresh && cached && now() - cached.at < cacheTtlMs) return cached.keys;
      if (!inFlight) inFlight = readSecret().finally(() => { inFlight = null; });
      return inFlight;
    },
    // Which pool answers right now, for the health surface. Never a secret.
    source(): "secret" | "own" | "shared" | "none" {
      if (secretId && cached) return "secret";
      if (readTutorKeys(input.env.STUDY_GROUP_TUTOR_KEYS).length > 0) return "own";
      return studyGroupTutorKeys(input.env).length > 0 ? "shared" : "none";
    }
  };
}

export function createAwsTutorKeySource(input: { region?: string; env: Record<string, string | undefined>; client?: SecretsManagerClient }) {
  const secretId = input.env.STUDY_GROUP_TUTOR_KEYS_SECRET_ID?.trim();
  const client = secretId ? input.client ?? new SecretsManagerClient(input.region ? { region: input.region } : {}) : null;
  return createTutorKeySource({
    secretId,
    env: input.env,
    reader: client ? {
      async getSecretValue(id) {
        const response = await client.send(new GetSecretValueCommand({ SecretId: id }));
        return response.SecretString;
      }
    } : null
  });
}

let shared: ReturnType<typeof createAwsTutorKeySource> | null = null;

// One source per process, so the runtime and /api/health/config see the same pool.
export function studyGroupTutorKeySource(region?: string) {
  shared ??= createAwsTutorKeySource({ region, env: process.env });
  return shared;
}
