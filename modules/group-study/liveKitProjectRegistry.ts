import { LiveKitGatewayError } from "./liveKitGateway";

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
  selectForNewSession(input: { sessionId: string; region?: string; excludeProjectIds?: ReadonlySet<string> }): LiveKitProjectRef;
  getAssigned(projectId: string): LiveKitProjectRef;
  all(): ReadonlyArray<LiveKitProjectRef>;
  diagnostics(): ReadonlyArray<LiveKitProjectDiagnostic>;
  // A hot list (createHotLiveKitProjectRegistry) re-reads its source here
  // once its cache is stale; callers await it before the reads above. A fixed
  // list has nothing to refresh.
  refresh?(): Promise<void>;
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

type ProjectEntry = LiveKitProjectRef & { endpointHost: string };

function parseProjectEntries(raw: string | undefined): ReadonlyArray<ProjectEntry> {
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
  if (!entries.some((project) => project.state === "active")) throw new Error("At least one active LiveKit project is required.");
  return entries;
}

function registryOf(entries: ReadonlyArray<ProjectEntry>): LiveKitProjectRegistry {
  const active = entries.filter((project) => project.state === "active");
  const byId = new Map(entries.map((project) => [project.id, project]));
  return {
    selectForNewSession({ sessionId, region, excludeProjectIds }) {
      const candidates = active.filter((project) => (!region || project.region === region) && !excludeProjectIds?.has(project.id));
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
    all() {
      return [...entries];
    },
    diagnostics() {
      return entries.map(({ id, endpointHost, region, state }) => ({ id, endpointHost, region, state }));
    }
  };
}

export function parseLiveKitProjects(raw: string | undefined): LiveKitProjectRegistry {
  return registryOf(parseProjectEntries(raw));
}

export type LiveKitProjectListRejection = "unreadable" | "invalid";

// The project list, hot (LIVEKIT_PROJECTS_SECRET_ID): `read` returns the same
// JSON as LIVEKIT_PROJECTS_JSON and is called at most once a minute, from
// refresh(), with concurrent refreshes sharing one read. Adding a project,
// changing its url, weight or state, or draining it therefore needs no
// redeploy. A failed or invalid read keeps the last good list (and is tried
// again after the same minute); before any good read there is no list, and
// selecting or resolving a project fails typed, which the service answers
// with `unavailable`. A project that leaves the list stays resolvable as
// `draining` for the rest of this process, so the rooms already assigned to
// it keep their tokens, tutor messages and webhooks; it gets no new rooms and
// is no longer health-checked. An instance started after the removal never
// saw the project, which is why retirement drains first (livekit-operations.md).
export function createHotLiveKitProjectRegistry(input: {
  read: () => Promise<string | undefined>;
  now?: () => number;
  cacheTtlMs?: number;
  onRejected?: (reason: LiveKitProjectListRejection) => void;
}): LiveKitProjectRegistry & { refresh(): Promise<void> } {
  const now = input.now ?? Date.now;
  const cacheTtlMs = input.cacheTtlMs ?? 60_000;
  let entries: ReadonlyArray<ProjectEntry> = [];
  let current: LiveKitProjectRegistry | null = null;
  const departed = new Map<string, ProjectEntry>();
  let readAt: number | null = null;
  let inFlight: Promise<void> | null = null;

  async function load() {
    let next: ReadonlyArray<ProjectEntry> | null = null;
    try {
      const raw = await input.read();
      try {
        next = parseProjectEntries(raw);
      } catch {
        input.onRejected?.("invalid");
      }
    } catch {
      input.onRejected?.("unreadable");
    }
    readAt = now();
    if (!next) return;
    const ids = new Set(next.map((project) => project.id));
    for (const project of entries) {
      if (!ids.has(project.id) && project.state !== "disabled") departed.set(project.id, { ...project, state: "draining" });
    }
    for (const id of ids) departed.delete(id);
    entries = next;
    current = registryOf(next);
  }

  function listed() {
    if (!current) throw new LiveKitGatewayError("credential_unavailable");
    return current;
  }

  return {
    refresh() {
      if (readAt !== null && now() - readAt < cacheTtlMs) return Promise.resolve();
      inFlight ??= load().finally(() => { inFlight = null; });
      return inFlight;
    },
    selectForNewSession(selection) {
      return listed().selectForNewSession(selection);
    },
    getAssigned(projectId) {
      const project = departed.get(projectId);
      return project ?? listed().getAssigned(projectId);
    },
    all() {
      return [...entries, ...departed.values()];
    },
    diagnostics() {
      return current?.diagnostics() ?? [];
    }
  };
}
