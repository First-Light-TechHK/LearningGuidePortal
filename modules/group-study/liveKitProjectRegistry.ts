export type LiveKitProjectState = "active" | "draining" | "disabled";

export type LiveKitProjectRef = Readonly<{
  id: string;
  url: string;
  region?: string;
  state: LiveKitProjectState;
  weight: number;
  credentialSecretId: string;
}>;

export type LiveKitProjectDiagnostic = Readonly<{
  id: string;
  endpointHost: string;
  region?: string;
  state: LiveKitProjectState;
}>;

export interface LiveKitProjectRegistry {
  selectForNewSession(input: { sessionId: string; region?: string }): LiveKitProjectRef;
  getAssigned(projectId: string): LiveKitProjectRef;
  diagnostics(): ReadonlyArray<LiveKitProjectDiagnostic>;
}

type ProjectConfig = {
  id?: unknown;
  url?: unknown;
  region?: unknown;
  state?: unknown;
  weight?: unknown;
  credentialSecretId?: unknown;
};

function nonEmptyString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`LiveKit project ${name} is required.`);
  return value.trim();
}

function parseEndpoint(value: unknown) {
  const url = nonEmptyString(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("LiveKit project url is invalid.");
  }
  if (parsed.protocol !== "wss:" || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("LiveKit project url must be a clean wss endpoint.");
  }
  return { url: parsed.toString().replace(/\/$/, ""), host: parsed.hostname };
}

function parseProject(input: unknown): LiveKitProjectRef & { endpointHost: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Each LiveKit project must be an object.");
  const config = input as ProjectConfig;
  const id = nonEmptyString(config.id, "id");
  const endpoint = parseEndpoint(config.url);
  const state = nonEmptyString(config.state, "state");
  if (state !== "active" && state !== "draining" && state !== "disabled") throw new Error("LiveKit project state is invalid.");
  const region = config.region === undefined ? undefined : nonEmptyString(config.region, "region");
  const credentialSecretId = nonEmptyString(config.credentialSecretId, "credentialSecretId");
  const weight = config.weight === undefined ? 1 : config.weight;
  if (typeof weight !== "number" || !Number.isSafeInteger(weight) || weight < 1) throw new Error("LiveKit project weight must be a positive integer.");
  return { id, url: endpoint.url, region, state, weight, credentialSecretId, endpointHost: endpoint.host };
}

function stableHash(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function parseLiveKitProjects(raw: string | undefined): LiveKitProjectRegistry {
  if (!raw?.trim()) throw new Error("LIVEKIT_PROJECTS_JSON is not configured.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("LIVEKIT_PROJECTS_JSON is not valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("LIVEKIT_PROJECTS_JSON must contain at least one project.");
  const entries = parsed.map(parseProject);
  const ids = new Set<string>();
  for (const project of entries) {
    if (ids.has(project.id)) throw new Error("LiveKit project ids must be unique.");
    ids.add(project.id);
  }
  const active = entries.filter((project) => project.state === "active");
  if (active.length === 0) throw new Error("At least one active LiveKit project is required.");

  const byId = new Map(entries.map((project) => [project.id, project]));
  return {
    selectForNewSession({ sessionId, region }) {
      const candidates = active.filter((project) => !region || project.region === region);
      if (candidates.length === 0) throw new Error("No active LiveKit project matches the requested region.");
      const totalWeight = candidates.reduce((total, project) => total + project.weight, 0);
      let selection = stableHash(sessionId) % totalWeight;
      for (const project of candidates) {
        if (selection < project.weight) return project;
        selection -= project.weight;
      }
      throw new Error("Unable to select a LiveKit project.");
    },
    getAssigned(projectId) {
      const project = byId.get(projectId);
      if (!project || project.state === "disabled") throw new Error("The assigned LiveKit project is unavailable.");
      return project;
    },
    diagnostics() {
      return entries.map(({ id, endpointHost, region, state }) => ({ id, endpointHost, region, state }));
    }
  };
}
