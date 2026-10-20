import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { createLiveKitCloudGateway, type LiveKitRoomService } from "../../modules/group-study/liveKitCloudGateway";
import { LiveKitGatewayError, type LiveKitCredentials, type LiveKitRoomGateway } from "../../modules/group-study/liveKitGateway";
import { parseLiveKitProjects, type LiveKitProjectRef } from "../../modules/group-study/liveKitProjectRegistry";
import { createLiveKitCredentialResolver } from "../../services/liveKitCredentials";

// Owner requirement 2026-10-20: every Study Group LiveKit key is hot. A key
// pair rotated in its project secret is used within the one-minute cache
// window by every path (room service calls, tutor data publish, token
// issuance, webhook verification, the health check), at once when the
// provider refuses the cached pair, and a failed read keeps the last good
// pair. Fake secret reader, fake provider and an injected clock; no AWS, no
// network. The hot project list is covered in study-group-livekit-hot-projects.

const START = Date.parse("2026-10-20T10:00:00.000Z");
const REAL_NOW_SECONDS = Math.floor(Date.now() / 1000);

const project: LiveKitProjectRef = {
  id: "eu-primary",
  url: "wss://eu-primary.livekit.cloud",
  state: "active",
  weight: 1,
  credentialSecretId: "lg/livekit/eu-primary"
};

function pair(name: string) {
  return { apiKey: `AP${name}`, apiSecret: `${name}-secret-at-least-32-characters-long` };
}

/** A Secrets Manager stand-in: one value per secret id, a read counter and a failure switch. */
function fakeSecrets(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  const state = { reads: 0, failing: false };
  return {
    state,
    set: (secretId: string, value: string) => { values.set(secretId, value); },
    reader: {
      async getSecretValue(secretId: string) {
        state.reads += 1;
        await Promise.resolve();
        if (state.failing) throw new Error("Secrets Manager is unavailable");
        return values.get(secretId);
      }
    }
  };
}

/** A LiveKit control plane that accepts only the key ids in `accepted` and records which key each call used. */
function fakeProvider(accepted: Set<string>) {
  const calls: Array<{ operation: string; apiKey: string }> = [];
  const call = async (operation: string, credentials: LiveKitCredentials) => {
    calls.push({ operation, apiKey: credentials.apiKey });
    if (!accepted.has(credentials.apiKey)) throw { status: 401, message: "provider detail" };
  };
  const createRoomService = async (_project: LiveKitProjectRef, credentials: LiveKitCredentials): Promise<LiveKitRoomService> => ({
    createRoom: () => call("createRoom", credentials),
    sendData: () => call("sendData", credentials),
    removeParticipant: () => call("removeParticipant", credentials),
    listParticipants: async () => { await call("listParticipants", credentials); return []; },
    listRooms: async () => { await call("listRooms", credentials); return []; }
  });
  return { calls, createRoomService };
}

function rotatingGateway(initial: string, accepted: Set<string>) {
  let nowMs = START;
  const secrets = fakeSecrets({ [project.credentialSecretId]: JSON.stringify(pair(initial)) });
  const resolver = createLiveKitCredentialResolver(secrets.reader, { now: () => new Date(nowMs), cacheTtlMs: 60_000 });
  const provider = fakeProvider(accepted);
  const gateway = createLiveKitCloudGateway({
    resolveCredentials: (target, options) => resolver.resolve(target, options),
    createRoomService: provider.createRoomService,
    now: () => new Date(nowMs)
  });
  return {
    gateway,
    secrets,
    provider,
    rotate: (name: string) => secrets.set(project.credentialSecretId, JSON.stringify(pair(name))),
    advanceSeconds: (seconds: number) => { nowMs += seconds * 1000; }
  };
}

const publish = (gateway: LiveKitRoomGateway, messageId: string) =>
  gateway.publishTutorMessage({ project, room: "session-1", messageId, text: "Answer", mode: "course" });

function tokenIssuer(token: string) {
  return (JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { iss: string }).iss;
}

test("a rotated key pair reaches every room-service call within the cache window", async () => {
  const f = rotatingGateway("old", new Set(["APold", "APnew"]));
  await f.gateway.ensureRoom({ project, room: "session-1", maxParticipants: 4 });
  // An overlapping rotation: both pairs are accepted while the cache runs out.
  f.rotate("new");
  f.advanceSeconds(30);
  await publish(f.gateway, "m-1");
  f.advanceSeconds(31);
  await f.gateway.removeParticipant({ project, room: "session-1", identity: "learner-1" });
  await f.gateway.listParticipants!({ project, room: "session-1" });
  assert.deepEqual(f.provider.calls.map((call) => `${call.operation}:${call.apiKey}`), [
    "createRoom:APold",
    "sendData:APold",
    "removeParticipant:APnew",
    "listParticipants:APnew"
  ]);
  assert.equal(f.secrets.state.reads, 2);
});

test("a provider refusal re-reads the secret at once and repeats the call with the rotated pair", async () => {
  const accepted = new Set(["APold"]);
  const f = rotatingGateway("old", accepted);
  await f.gateway.ensureRoom({ project, room: "session-1", maxParticipants: 4 });
  // The old key is revoked right after the new one is written, well inside
  // the cache window: every path must work again on its very next call.
  f.rotate("new");
  accepted.clear();
  accepted.add("APnew");
  f.advanceSeconds(1);
  await publish(f.gateway, "m-1");
  await f.gateway.ensureRoom({ project, room: "session-1", maxParticipants: 4 });
  await f.gateway.removeParticipant({ project, room: "session-1", identity: "learner-1" });
  assert.deepEqual(f.provider.calls.map((call) => `${call.operation}:${call.apiKey}`), [
    "createRoom:APold",
    "sendData:APold",
    "sendData:APnew",
    "createRoom:APnew",
    "removeParticipant:APnew"
  ]);
  assert.equal(f.secrets.state.reads, 2);

  // Concurrent refusals share one re-read.
  f.rotate("newer");
  accepted.clear();
  accepted.add("APnewer");
  f.advanceSeconds(1);
  await Promise.all([publish(f.gateway, "m-2"), publish(f.gateway, "m-3"), f.gateway.listParticipants!({ project, room: "session-1" })]);
  assert.equal(f.secrets.state.reads, 3);
  assert.equal(f.provider.calls.slice(-3).every((call) => call.apiKey === "APnewer"), true);
});

test("a refusal with an unchanged secret fails typed without repeating the provider call", async () => {
  const f = rotatingGateway("old", new Set());
  await assert.rejects(publish(f.gateway, "m-1"), (error: unknown) => error instanceof LiveKitGatewayError && error.code === "unauthorized" && !error.message.includes("provider detail"));
  assert.equal(f.provider.calls.length, 1);
  assert.equal(f.secrets.state.reads, 2);
});

test("token issuance follows a rotation through the verified recovery, then every token uses the new pair", async () => {
  const accepted = new Set(["APold"]);
  const f = rotatingGateway("old", accepted);
  const input = { project, room: "session-1", identity: "learner-1", name: "Learner", ttlSeconds: 600 };
  assert.equal(tokenIssuer((await f.gateway.issueParticipantToken(input)).token), "APold");
  f.rotate("new");
  accepted.clear();
  accepted.add("APnew");
  f.advanceSeconds(1);
  // Inside the window a plain issuance still signs with the cached pair; the
  // browser's join fails and it asks once for a verified token, which re-reads
  // the secret at once and proves the new pair with the provider.
  assert.equal(tokenIssuer((await f.gateway.issueParticipantToken(input)).token), "APold");
  assert.equal(tokenIssuer((await f.gateway.recoverParticipantToken!(input)).token), "APnew");
  assert.equal(tokenIssuer((await f.gateway.issueParticipantToken(input)).token), "APnew");
  assert.equal(f.secrets.state.reads, 2);
});

test("the health check proves the pair currently in the secret, not the cached one", async () => {
  const accepted = new Set(["APold"]);
  const f = rotatingGateway("old", accepted);
  await f.gateway.ensureRoom({ project, room: "session-1", maxParticipants: 4 });
  f.rotate("new");
  accepted.clear();
  accepted.add("APnew");
  f.advanceSeconds(1);
  const health = await f.gateway.healthCheck({ project, forceRefresh: true });
  assert.equal(health.status, "healthy");
  assert.equal(f.provider.calls.at(-1)?.apiKey, "APnew");
});

test("a failed or invalid credential read keeps the last good pair", async () => {
  let nowMs = START;
  const secrets = fakeSecrets({ [project.credentialSecretId]: JSON.stringify(pair("old")) });
  const resolver = createLiveKitCredentialResolver(secrets.reader, { now: () => new Date(nowMs), cacheTtlMs: 60_000 });
  assert.equal((await resolver.resolve(project)).apiKey, "APold");
  secrets.state.failing = true;
  nowMs += 61_000;
  assert.equal((await resolver.resolve(project)).apiKey, "APold");
  assert.equal((await resolver.resolve(project, { forceRefresh: true })).apiKey, "APold");
  secrets.state.failing = false;
  secrets.set(project.credentialSecretId, "not-json");
  nowMs += 61_000;
  assert.equal((await resolver.resolve(project)).apiKey, "APold");
  // A failed read is retried after the same minute, not on every call.
  const reads = secrets.state.reads;
  await resolver.resolve(project);
  assert.equal(secrets.state.reads, reads);
  // Never a good read: nothing to fall back to.
  await assert.rejects(resolver.resolve({ ...project, credentialSecretId: "lg/livekit/missing" }));
});

function sign(body: string, credentials: LiveKitCredentials) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const sha256 = createHash("sha256").update(body, "utf8").digest("base64");
  const payload = Buffer.from(JSON.stringify({ iss: credentials.apiKey, exp: REAL_NOW_SECONDS + 60, sha256 })).toString("base64url");
  const signature = createHmac("sha256", credentials.apiSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const webhookBody = JSON.stringify({
  event: "participant_left",
  id: "EV_hot_1",
  createdAt: String(START / 1000),
  room: { name: "session-1", sid: "RM_1" },
  participant: { identity: "learner-1", sid: "PA_1" }
});

test("a webhook signed with a key rotated in within the cache window verifies at once; unknown issuers re-read at most every 10 s", async () => {
  let nowMs = START;
  const secrets = fakeSecrets({ [project.credentialSecretId]: JSON.stringify(pair("old")) });
  const resolver = createLiveKitCredentialResolver(secrets.reader, { now: () => new Date(nowMs), cacheTtlMs: 60_000 });
  const gateway = createLiveKitCloudGateway({
    registry: parseLiveKitProjects(JSON.stringify([project])),
    resolveCredentials: (target, options) => resolver.resolve(target, options),
    now: () => new Date(nowMs)
  });
  assert.equal((await gateway.verifyWebhook!({ rawBody: webhookBody, authHeader: sign(webhookBody, pair("old")) })).projectId, project.id);
  secrets.set(project.credentialSecretId, JSON.stringify(pair("new")));
  nowMs += 1_000;
  assert.equal((await gateway.verifyWebhook!({ rawBody: webhookBody, authHeader: sign(webhookBody, pair("new")) })).projectId, project.id);
  assert.equal(secrets.state.reads, 2);

  // Anyone can post an unknown issuer: it costs at most one re-read per 10 s.
  const unverified = (error: unknown) => error instanceof LiveKitGatewayError && error.code === "unverified";
  nowMs += 1_000;
  await assert.rejects(gateway.verifyWebhook!({ rawBody: webhookBody, authHeader: sign(webhookBody, pair("stranger")) }), unverified);
  assert.equal(secrets.state.reads, 2);
  nowMs += 10_000;
  await assert.rejects(gateway.verifyWebhook!({ rawBody: webhookBody, authHeader: sign(webhookBody, pair("stranger")) }), unverified);
  await assert.rejects(gateway.verifyWebhook!({ rawBody: webhookBody, authHeader: sign(webhookBody, pair("stranger")) }), unverified);
  assert.equal(secrets.state.reads, 3);
});
