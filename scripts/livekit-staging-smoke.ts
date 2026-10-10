import { AccessToken, RoomServiceClient, TokenVerifier } from "livekit-server-sdk";

type PublicStagingConfig = Readonly<{ url: string; runId: string }>;
type Environment = Record<string, string | undefined>;

type StagingRoomService = {
  createRoom(input: { name: string; maxParticipants: number }): Promise<unknown>;
  listRooms(names?: string[]): Promise<ReadonlyArray<{ name?: string }>>;
  deleteRoom(name: string): Promise<void>;
};

type SmokeDeps = {
  config: PublicStagingConfig;
  createRoomService: () => StagingRoomService;
  signAndVerifyParticipantToken: (input: { room: string; identity: string }) => Promise<void>;
};

function required(env: Environment, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function roomServiceUrl(url: string) {
  return url.replace(/^wss:/i, "https:");
}

function temporaryRoomName(runId: string) {
  return `studygroup-ci-${runId}`;
}

export function readLiveKitStagingConfig(env: Environment): PublicStagingConfig {
  const url = required(env, "LIVEKIT_STAGING_URL");
  if (!/^wss:\/\/[^/]+(?:\/.*)?$/i.test(url)) throw new Error("LIVEKIT_STAGING_URL must use wss://.");
  required(env, "LIVEKIT_STAGING_API_KEY");
  required(env, "LIVEKIT_STAGING_API_SECRET");
  const runId = required(env, "LIVEKIT_SMOKE_RUN_ID");
  if (!/^\d+-\d+$/.test(runId)) throw new Error("LIVEKIT_SMOKE_RUN_ID must be a GitHub run id and attempt.");
  return { url, runId };
}

export async function runLiveKitStagingSmoke(deps: SmokeDeps) {
  const room = temporaryRoomName(deps.config.runId);
  const identity = `studygroup-smoke-${deps.config.runId}`;
  const roomService = deps.createRoomService();
  let createAttempted = false;
  let failed = false;
  try {
    createAttempted = true;
    await roomService.createRoom({ name: room, maxParticipants: 2 });
    const rooms = await roomService.listRooms([room]);
    if (!rooms.some((candidate) => candidate.name === room)) throw new Error("LiveKit did not return the temporary room.");
    await deps.signAndVerifyParticipantToken({ room, identity });
    return { roomProvisioned: true, participantTokenVerified: true };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!createAttempted) return;
    try {
      // A timed-out create can still have reached LiveKit. The name is unique to
      // this Actions attempt, so a best-effort delete is safe in both outcomes.
      await roomService.deleteRoom(room);
    } catch {
      if (!failed) throw new Error("LiveKit temporary-room cleanup failed.");
    }
  }
}

async function main() {
  const config = readLiveKitStagingConfig(process.env);
  const apiKey = required(process.env, "LIVEKIT_STAGING_API_KEY");
  const apiSecret = required(process.env, "LIVEKIT_STAGING_API_SECRET");
  const roomService = new RoomServiceClient(roomServiceUrl(config.url), apiKey, apiSecret);
  const result = await runLiveKitStagingSmoke({
    config,
    createRoomService: () => roomService,
    signAndVerifyParticipantToken: async ({ room, identity }) => {
      const token = new AccessToken(apiKey, apiSecret, { identity, ttl: 60 });
      token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
      await new TokenVerifier(apiKey, apiSecret).verify(await token.toJwt());
    }
  });
  console.info(JSON.stringify({ type: "study_group.livekit_staging_smoke", ...result }));
}

if (process.argv[1]?.endsWith("livekit-staging-smoke.ts")) {
  void main().catch(() => {
    console.error("LiveKit staging smoke failed. Inspect the protected GitHub Actions job for the redacted failure context.");
    process.exitCode = 1;
  });
}
