import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { LiveKitCredentials } from "@/modules/group-study/liveKitGateway";
import type { LiveKitProjectRef } from "@/modules/group-study/liveKitProjectRegistry";

export type SecretValueReader = {
  getSecretValue(secretId: string): Promise<string | undefined>;
};

export type LiveKitCredentialResolveOptions = Readonly<{ forceRefresh?: boolean }>;

// Why a credential read was not used: the secret could not be read (missing,
// empty, no permission, timeout) or it was read but is not a key pair.
// `keptLastGood` says whether the previous pair is still in use. Redacted:
// never the secret's value.
export type LiveKitCredentialRejection = Readonly<{
  projectId: string;
  reason: "unreadable" | "invalid";
  keptLastGood: boolean;
}>;

// The secret holds {"apiKey","apiSecret"}. Operators also write the pair
// under LiveKit's own variable names (the console's "copy as env" output,
// LIVEKIT_API_KEY / LIVEKIT_API_SECRET) or snake_case, often when a key is
// replaced by hand; those spellings name the same field and are read too.
// Two spellings of one field holding different values are ambiguous and
// rejected rather than guessed.
const CREDENTIAL_FIELD_NAMES = {
  apiKey: ["apiKey", "LIVEKIT_API_KEY", "api_key"],
  apiSecret: ["apiSecret", "LIVEKIT_API_SECRET", "api_secret"]
} as const;

function requiredSecretField(value: Record<string, unknown>, field: keyof typeof CREDENTIAL_FIELD_NAMES) {
  const present = CREDENTIAL_FIELD_NAMES[field]
    .map((name) => value[name])
    .filter((item) => item !== undefined);
  const values = present.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (values.length === 0 || values.some((item) => !item)) throw new Error(`LiveKit credential ${field} is missing.`);
  if (new Set(values).size > 1) throw new Error(`LiveKit credential ${field} is given twice with different values.`);
  return values[0];
}

export function parseLiveKitCredentials(raw: string): LiveKitCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("LiveKit credentials are not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("LiveKit credentials must be an object.");
  const value = parsed as Record<string, unknown>;
  return { apiKey: requiredSecretField(value, "apiKey"), apiSecret: requiredSecretField(value, "apiSecret") };
}

// Each project's key pair is read from its Secrets Manager secret at run time
// and re-read at most once a minute, so a rotation written to the secret
// takes effect without a redeploy. `forceRefresh` re-reads at once: the
// gateway asks for it when the provider refuses the cached pair. Concurrent
// reads of one secret share one request. A failed or invalid read keeps the
// last good pair (the provider stays the judge of whether it still works);
// with none yet, the read fails. Every rejected read is reported through
// `onRejected` so an operator can tell a bad secret from a refused key.
export function createLiveKitCredentialResolver(
  reader: SecretValueReader,
  input: { now?: () => Date; cacheTtlMs?: number; onRejected?: (rejection: LiveKitCredentialRejection) => void } = {}
) {
  const now = input.now ?? (() => new Date());
  const cacheTtlMs = input.cacheTtlMs ?? 60_000;
  const cached = new Map<string, { credentials: LiveKitCredentials; at: number }>();
  const inFlight = new Map<string, Promise<LiveKitCredentials>>();

  async function readCurrent(project: LiveKitProjectRef) {
    const secretId = project.credentialSecretId;
    let reason: LiveKitCredentialRejection["reason"] = "unreadable";
    try {
      const raw = await reader.getSecretValue(secretId);
      if (!raw) throw new Error("LiveKit credentials are unavailable.");
      reason = "invalid";
      const credentials = parseLiveKitCredentials(raw);
      cached.set(secretId, { credentials, at: now().getTime() });
      return credentials;
    } catch (error) {
      const lastGood = cached.get(secretId);
      try {
        input.onRejected?.({ projectId: project.id, reason, keptLastGood: Boolean(lastGood) });
      } catch {
        // Reporting must never change which key pair is used.
      }
      if (!lastGood) throw error;
      cached.set(secretId, { credentials: lastGood.credentials, at: now().getTime() });
      return lastGood.credentials;
    }
  }

  return {
    async resolve(project: LiveKitProjectRef, options: LiveKitCredentialResolveOptions = {}): Promise<LiveKitCredentials> {
      const secretId = project.credentialSecretId;
      const existing = cached.get(secretId);
      if (!options.forceRefresh && existing && now().getTime() - existing.at < cacheTtlMs) return existing.credentials;
      const pending = inFlight.get(secretId);
      if (pending) return pending;
      const operation = readCurrent(project).finally(() => { inFlight.delete(secretId); });
      inFlight.set(secretId, operation);
      return operation;
    }
  };
}

// One Secrets Manager reader for the LiveKit credentials and the hot project
// list (LIVEKIT_PROJECTS_SECRET_ID).
export function createAwsSecretValueReader(input: { region?: string; client?: SecretsManagerClient } = {}): SecretValueReader {
  const client = input.client ?? new SecretsManagerClient({ ...(input.region ? { region: input.region } : {}), maxAttempts: 2 });
  return {
    async getSecretValue(secretId) {
      // Bounded: the SDK has no timeout of its own, and a stalled read would
      // hold a token issuance or the project list refresh behind it.
      const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }), { abortSignal: AbortSignal.timeout(3_000) });
      return response.SecretString;
    }
  };
}

export function createAwsLiveKitCredentialResolver(input: { region?: string; client?: SecretsManagerClient; reader?: SecretValueReader; onRejected?: (rejection: LiveKitCredentialRejection) => void } = {}) {
  return createLiveKitCredentialResolver(input.reader ?? createAwsSecretValueReader(input), { onRejected: input.onRejected });
}
