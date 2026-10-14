import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { LiveKitGatewayError, type LiveKitCredentials } from "../../modules/group-study/liveKitGateway";
import { createLiveKitCloudGateway } from "../../modules/group-study/liveKitCloudGateway";
import { parseLiveKitProjects } from "../../modules/group-study/liveKitProjectRegistry";

const NOW = new Date("2026-10-11T02:00:00.000Z");
// Token expiry is validated against the real clock (jose exp check), so vectors
// use real time for exp; createdAt assertions keep the fixed instant above.
const REAL_NOW_SECONDS = Math.floor(Date.now() / 1000);

const registry = parseLiveKitProjects(JSON.stringify([
  { id: "beta", url: "wss://beta.livekit.cloud", state: "draining", credentialSecretId: "secret-beta" },
  { id: "alpha", url: "wss://alpha.livekit.cloud", state: "active", credentialSecretId: "secret-alpha" }
]));

const credentialsBySecret: Record<string, LiveKitCredentials> = {
  "secret-alpha": { apiKey: "APalpha0000000000", apiSecret: "alpha-secret-0000000000000000000000" },
  "secret-beta": { apiKey: "APbeta00000000000", apiSecret: "beta-secret-00000000000000000000000" }
};

const alpha = credentialsBySecret["secret-alpha"];
const beta = credentialsBySecret["secret-beta"];

function gateway(options: { providerVerified?: boolean } = {}) {
  return createLiveKitCloudGateway({
    registry,
    resolveCredentials: async (project) => {
      const credentials = credentialsBySecret[project.credentialSecretId];
      if (!credentials) throw new Error("unknown secret");
      return credentials;
    },
    providerVerified: options.providerVerified ?? true,
    now: () => NOW
  });
}

function b64url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

// Mirrors the provider's signing: compact HS256 JWT carrying iss apiKey, a
// required exp, and the standard-base64 SHA-256 of the exact raw body.
function sign(body: string, apiKey: string, apiSecret: string, options: { expSeconds?: number } = {}) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const sha256 = createHash("sha256").update(body, "utf8").digest("base64");
  const payload = b64url(JSON.stringify({ iss: apiKey, exp: options.expSeconds ?? REAL_NOW_SECONDS + 60, sha256 }));
  const signature = createHmac("sha256", apiSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function participantLeftBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: "participant_left",
    id: "EV_webhook_1",
    createdAt: String(NOW.getTime() * 1000),
    room: { name: "s-session-1", sid: "RM_1" },
    participant: { identity: "u-7", sid: "PA_1" },
    ...overrides
  });
}

async function expectUnverified(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => error instanceof LiveKitGatewayError && error.code === "unverified");
}

test("a signed webhook verifies, resolves its project by issuer, and maps the typed event", async () => {
  const body = participantLeftBody();
  const event = await gateway().verifyWebhook!({ rawBody: body, authHeader: sign(body, beta.apiKey, beta.apiSecret) });
  assert.deepEqual(event, {
    eventId: "EV_webhook_1",
    eventType: "participant_left",
    room: "s-session-1",
    participantIdentity: "u-7",
    // The connection-level id travels with the mapped event (audit F-5): the
    // service matches it against the seat's recorded connection.
    participantSid: "PA_1",
    createdAt: NOW.toISOString(),
    projectId: "beta"
  });
});

test("an event without a room or participant maps to null fields but still verifies", async () => {
  const body = JSON.stringify({ event: "egress_started", id: "EV_webhook_2", createdAt: String(NOW.getTime() * 1000) });
  const event = await gateway().verifyWebhook!({ rawBody: body, authHeader: sign(body, alpha.apiKey, alpha.apiSecret) });
  assert.equal(event.eventType, "egress_started");
  assert.equal(event.room, null);
  assert.equal(event.participantIdentity, null);
  assert.equal(event.participantSid, null);
  assert.equal(event.projectId, "alpha");
});

test("a tampered body is rejected even when the header signature is genuine", async () => {
  const body = participantLeftBody();
  const header = sign(body, alpha.apiKey, alpha.apiSecret);
  await expectUnverified(gateway().verifyWebhook!({ rawBody: `${body} `, authHeader: header }));
});

test("a signature produced with another project's secret is rejected", async () => {
  const body = participantLeftBody();
  await expectUnverified(gateway().verifyWebhook!({ rawBody: body, authHeader: sign(body, alpha.apiKey, beta.apiSecret) }));
});

test("an unknown issuer is rejected", async () => {
  const body = participantLeftBody();
  await expectUnverified(gateway().verifyWebhook!({ rawBody: body, authHeader: sign(body, "APunknown000000000", alpha.apiSecret) }));
});

test("a missing Authorization header or an unparseable token is rejected", async () => {
  const body = participantLeftBody();
  await expectUnverified(gateway().verifyWebhook!({ rawBody: body, authHeader: null }));
  await expectUnverified(gateway().verifyWebhook!({ rawBody: body, authHeader: "not-a-jwt" }));
});

test("an expired token is rejected", async () => {
  const body = participantLeftBody();
  await expectUnverified(gateway().verifyWebhook!({ rawBody: body, authHeader: sign(body, alpha.apiKey, alpha.apiSecret, { expSeconds: REAL_NOW_SECONDS - 300 }) }));
});

test("an event without an id is rejected", async () => {
  const parsed = JSON.parse(participantLeftBody()) as Record<string, unknown>;
  delete parsed.id;
  const idless = JSON.stringify(parsed);
  await expectUnverified(gateway().verifyWebhook!({ rawBody: idless, authHeader: sign(idless, alpha.apiKey, alpha.apiSecret) }));
});

test("the fake (unverified) gateway never accepts any vector", async () => {
  const body = participantLeftBody();
  await expectUnverified(gateway({ providerVerified: false }).verifyWebhook!({ rawBody: body, authHeader: sign(body, alpha.apiKey, alpha.apiSecret) }));
});
