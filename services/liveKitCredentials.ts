import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { LiveKitCredentials } from "@/modules/group-study/liveKitGateway";
import type { LiveKitProjectRef } from "@/modules/group-study/liveKitProjectRegistry";

export type SecretValueReader = {
  getSecretValue(secretId: string): Promise<string | undefined>;
};

export type LiveKitCredentialResolveOptions = Readonly<{ forceRefresh?: boolean }>;

function requiredSecretField(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`LiveKit credential ${field} is missing.`);
  return value.trim();
}

export function parseLiveKitCredentials(raw: string): LiveKitCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("LiveKit credentials are not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("LiveKit credentials must be an object.");
  const value = parsed as { apiKey?: unknown; apiSecret?: unknown };
  return { apiKey: requiredSecretField(value.apiKey, "apiKey"), apiSecret: requiredSecretField(value.apiSecret, "apiSecret") };
}

// Each project's key pair is read from its Secrets Manager secret at run time
// and re-read at most once a minute, so a rotation written to the secret
// takes effect without a redeploy. `forceRefresh` re-reads at once: the
// gateway asks for it when the provider refuses the cached pair. Concurrent
// reads of one secret share one request. A failed or invalid read keeps the
// last good pair (the provider stays the judge of whether it still works);
// with none yet, the read fails.
export function createLiveKitCredentialResolver(
  reader: SecretValueReader,
  input: { now?: () => Date; cacheTtlMs?: number } = {}
) {
  const now = input.now ?? (() => new Date());
  const cacheTtlMs = input.cacheTtlMs ?? 60_000;
  const cached = new Map<string, { credentials: LiveKitCredentials; at: number }>();
  const inFlight = new Map<string, Promise<LiveKitCredentials>>();

  async function readCurrent(project: LiveKitProjectRef) {
    const secretId = project.credentialSecretId;
    try {
      const raw = await reader.getSecretValue(secretId);
      if (!raw) throw new Error("LiveKit credentials are unavailable.");
      const credentials = parseLiveKitCredentials(raw);
      cached.set(secretId, { credentials, at: now().getTime() });
      return credentials;
    } catch (error) {
      const lastGood = cached.get(secretId);
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
  const client = input.client ?? new SecretsManagerClient(input.region ? { region: input.region } : {});
  return {
    async getSecretValue(secretId) {
      const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
      return response.SecretString;
    }
  };
}

export function createAwsLiveKitCredentialResolver(input: { region?: string; client?: SecretsManagerClient; reader?: SecretValueReader } = {}) {
  return createLiveKitCredentialResolver(input.reader ?? createAwsSecretValueReader(input));
}
