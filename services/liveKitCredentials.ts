import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { LiveKitCredentials } from "@/modules/group-study/liveKitGateway";
import type { LiveKitProjectRef } from "@/modules/group-study/liveKitProjectRegistry";

type SecretValueReader = {
  getSecretValue(secretId: string): Promise<string | undefined>;
};

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

export function createLiveKitCredentialResolver(reader: SecretValueReader) {
  return {
    async resolve(project: LiveKitProjectRef): Promise<LiveKitCredentials> {
      const raw = await reader.getSecretValue(project.credentialSecretId);
      if (!raw) throw new Error("LiveKit credentials are unavailable.");
      return parseLiveKitCredentials(raw);
    }
  };
}

export function createAwsLiveKitCredentialResolver(input: { region?: string; client?: SecretsManagerClient } = {}) {
  const client = input.client ?? new SecretsManagerClient(input.region ? { region: input.region } : {});
  return createLiveKitCredentialResolver({
    async getSecretValue(secretId) {
      const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
      return response.SecretString;
    }
  });
}
