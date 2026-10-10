import type { LiveKitProjectHealthEvidence, LiveKitProjectHealthStatus, LiveKitRoomGateway } from "./liveKitGateway";
import type { LiveKitProjectRegistry, LiveKitProjectState } from "./liveKitProjectRegistry";

export type LiveKitHealthProject = Readonly<{
  id: string;
  endpointHost: string;
  region?: string;
  state: Exclude<LiveKitProjectState, "disabled">;
  status: LiveKitProjectHealthStatus;
  evidence: LiveKitProjectHealthEvidence;
  checkedAt: string;
  latencyMs: number;
  activeRooms?: number;
}>;

export type LiveKitHealthSnapshot = Readonly<{
  checkedAt: string;
  ready: boolean;
  attentionRequired: boolean;
  projects: ReadonlyArray<LiveKitHealthProject>;
}>;

export interface LiveKitHealthService {
  check(): Promise<LiveKitHealthSnapshot>;
}

type LiveKitHealthDeps = {
  registry: LiveKitProjectRegistry;
  gateway: LiveKitRoomGateway;
  now?: () => Date;
  cacheTtlMs?: number;
};

export function createLiveKitHealthService(deps: LiveKitHealthDeps): LiveKitHealthService {
  const now = deps.now ?? (() => new Date());
  const cacheTtlMs = deps.cacheTtlMs ?? 60_000;
  let cached: { at: number; value: LiveKitHealthSnapshot } | undefined;
  let checking: Promise<LiveKitHealthSnapshot> | undefined;

  async function fresh() {
    const expected = deps.registry.diagnostics().filter((project) => project.state !== "disabled");
    const projects = await Promise.all(expected.map(async (diagnostic) => {
      const result = await deps.gateway.healthCheck({ project: deps.registry.getAssigned(diagnostic.id) });
      return {
        id: diagnostic.id,
        endpointHost: diagnostic.endpointHost,
        ...(diagnostic.region ? { region: diagnostic.region } : {}),
        state: diagnostic.state,
        status: result.status,
        evidence: result.evidence,
        checkedAt: result.checkedAt,
        latencyMs: result.latencyMs,
        ...(result.activeRooms === undefined ? {} : { activeRooms: result.activeRooms })
      } as LiveKitHealthProject;
    }));
    const ready = projects.filter((project) => project.state === "active").every((project) => project.status === "healthy");
    return { checkedAt: now().toISOString(), ready, attentionRequired: projects.some((project) => project.status !== "healthy"), projects };
  }

  return {
    async check() {
      const timestamp = now().getTime();
      if (cached && timestamp - cached.at < cacheTtlMs) return cached.value;
      checking ??= fresh().then((value) => {
        cached = { at: now().getTime(), value };
        return value;
      }).finally(() => { checking = undefined; });
      return checking;
    }
  };
}
