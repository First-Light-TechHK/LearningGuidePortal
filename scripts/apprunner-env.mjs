// Pure helpers for merging App Runner runtime configuration.
//
// App Runner source deployments rebuild code but keep the service configuration,
// so environment variables belong to the service, not to the repository. These
// helpers let the deploy workflow merge a few required keys without dropping
// anything an operator already set.

/** App Runner serves a service on HTTPS 443; a container port in the URL is unreachable. */
export function assertPublicHttpsUrl(value, key = "KS_TUTOR_BASE_URL") {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${key} is required`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${key} is not a valid URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${key} must use https`);
  if (url.port) throw new Error(`${key} must not include a port (App Runner serves on 443)`);
  if (["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(url.hostname)) {
    throw new Error(`${key} must not point to localhost`);
  }
  if (url.username || url.password) throw new Error(`${key} must not contain credentials`);
  return raw.replace(/\/+$/, "");
}

/** Secret values stay in Secrets Manager; the service only receives the ARN. */
export function assertSecretArn(value, key) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${key} is required`);
  if (!/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/.test(raw)) {
    throw new Error(`${key} is not a Secrets Manager ARN`);
  }
  return raw;
}

function runtimeValues(sourceConfiguration) {
  const code = sourceConfiguration?.CodeRepository?.CodeConfiguration?.CodeConfigurationValues;
  if (code) return code;
  const image = sourceConfiguration?.ImageRepository?.ImageConfiguration;
  if (image) return image;
  throw new Error("App Runner source configuration has neither CodeRepository nor ImageRepository");
}

/**
 * Merge desired variables/secrets into a copy of the App Runner source
 * configuration. Empty values are skipped so a missing option never clears an
 * existing runtime value. Existing keys not mentioned here are preserved.
 */
export function mergeRuntimeConfiguration(sourceConfiguration, desired = {}) {
  const source = structuredClone(sourceConfiguration);
  const values = runtimeValues(source);
  const variables = { ...(values.RuntimeEnvironmentVariables ?? {}) };
  const secrets = { ...(values.RuntimeEnvironmentSecrets ?? {}) };
  const applied = { variables: [], secrets: [] };
  let changed = false;

  for (const [key, raw] of Object.entries(desired.variables ?? {})) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    if (variables[key] !== value) {
      variables[key] = value;
      changed = true;
    }
    applied.variables.push(key);
  }

  for (const [key, raw] of Object.entries(desired.secrets ?? {})) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    if (secrets[key] !== value) {
      secrets[key] = value;
      changed = true;
    }
    applied.secrets.push(key);
  }

  if (Object.keys(variables).length) values.RuntimeEnvironmentVariables = variables;
  if (Object.keys(secrets).length) values.RuntimeEnvironmentSecrets = secrets;

  return { sourceConfiguration: source, changed, applied };
}
