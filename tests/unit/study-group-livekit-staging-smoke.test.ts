import assert from "node:assert/strict";
import { test } from "node:test";
import { readLiveKitStagingConfig, runLiveKitStagingSmoke } from "../../scripts/livekit-staging-smoke";

test("staging smoke requires a dedicated secure endpoint and never returns credentials", async () => {
  assert.throws(
    () => readLiveKitStagingConfig({ LIVEKIT_STAGING_URL: "http://livekit.example.test", LIVEKIT_STAGING_API_KEY: "key", LIVEKIT_STAGING_API_SECRET: "secret", LIVEKIT_SMOKE_RUN_ID: "123-1" }),
    /wss/i
  );
  const config = readLiveKitStagingConfig({ LIVEKIT_STAGING_URL: "wss://staging.livekit.cloud", LIVEKIT_STAGING_API_KEY: "key", LIVEKIT_STAGING_API_SECRET: "secret", LIVEKIT_SMOKE_RUN_ID: "123-1" });
  assert.deepEqual(Object.keys(config).sort(), ["runId", "url"]);

  const calls: string[] = [];
  const result = await runLiveKitStagingSmoke({
    config,
    createRoomService: () => ({
      createRoom: async ({ name, maxParticipants }) => { calls.push(`create:${name}:${maxParticipants}`); },
      listRooms: async (names) => { calls.push(`list:${names?.join(",")}`); return [{ name: names?.[0] }]; },
      deleteRoom: async (name) => { calls.push(`delete:${name}`); }
    }),
    signAndVerifyParticipantToken: async ({ room, identity }) => { calls.push(`token:${room}:${identity}`); }
  });

  assert.deepEqual(result, { roomProvisioned: true, participantTokenVerified: true });
  assert.equal(calls[0]?.startsWith("create:studygroup-ci-123-1:"), true);
  assert.equal(calls.some((call) => call.startsWith("list:studygroup-ci-123-1")), true);
  assert.equal(calls.some((call) => call.startsWith("token:studygroup-ci-123-1")), true);
  assert.equal(calls.at(-1)?.startsWith("delete:studygroup-ci-123-1"), true);
});

test("staging smoke always deletes its temporary room after a failed verification", async () => {
  const config = readLiveKitStagingConfig({ LIVEKIT_STAGING_URL: "wss://staging.livekit.cloud", LIVEKIT_STAGING_API_KEY: "key", LIVEKIT_STAGING_API_SECRET: "secret", LIVEKIT_SMOKE_RUN_ID: "124-1" });
  const calls: string[] = [];
  await assert.rejects(
    () => runLiveKitStagingSmoke({
      config,
      createRoomService: () => ({
        createRoom: async ({ name }) => { calls.push(`create:${name}`); },
        listRooms: async () => [],
        deleteRoom: async (name) => { calls.push(`delete:${name}`); }
      }),
      signAndVerifyParticipantToken: async () => { throw new Error("not reached"); }
    }),
    /did not return the temporary room/
  );
  assert.equal(calls.at(-1)?.startsWith("delete:studygroup-ci-124-1"), true);
});

test("staging smoke also attempts cleanup after an uncertain room-create failure", async () => {
  const config = readLiveKitStagingConfig({ LIVEKIT_STAGING_URL: "wss://staging.livekit.cloud", LIVEKIT_STAGING_API_KEY: "key", LIVEKIT_STAGING_API_SECRET: "secret", LIVEKIT_SMOKE_RUN_ID: "125-1" });
  const calls: string[] = [];
  await assert.rejects(
    () => runLiveKitStagingSmoke({
      config,
      createRoomService: () => ({
        createRoom: async ({ name }) => { calls.push(`create:${name}`); throw new Error("timeout"); },
        listRooms: async () => [],
        deleteRoom: async (name) => { calls.push(`delete:${name}`); }
      }),
      signAndVerifyParticipantToken: async () => undefined
    }),
    /timeout/
  );
  assert.equal(calls.at(-1)?.startsWith("delete:studygroup-ci-125-1"), true);
});
