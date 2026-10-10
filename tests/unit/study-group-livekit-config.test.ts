import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLiveKitProjects, type LiveKitProjectRegistry } from "../../modules/group-study/liveKitProjectRegistry";

const projectJson = JSON.stringify([
  {
    id: "eu-primary",
    url: "wss://eu-primary.livekit.cloud",
    region: "eu-central",
    state: "active",
    weight: 3,
    credentialSecretId: "learning-guide/livekit/eu-primary"
  },
  {
    id: "eu-draining",
    url: "wss://eu-draining.livekit.cloud",
    region: "eu-central",
    state: "draining",
    weight: 1,
    credentialSecretId: "learning-guide/livekit/eu-draining"
  }
]);

test("registry deterministically selects an active project and retains an assigned draining project", () => {
  const registry = parseLiveKitProjects(projectJson);
  const first = registry.selectForNewSession({ sessionId: "session-123" });
  const second = registry.selectForNewSession({ sessionId: "session-123" });

  assert.equal(first.id, "eu-primary");
  assert.deepEqual(second, first);
  assert.equal(registry.getAssigned("eu-draining").state, "draining");
});

test("registry rejects unsafe or ambiguous project configuration", () => {
  for (const projects of [
    [{ id: "only", url: "https://not-websocket.example", state: "active", credentialSecretId: "secret" }],
    [{ id: "same", url: "wss://one.example", state: "active", credentialSecretId: "first" }, { id: "same", url: "wss://two.example", state: "active", credentialSecretId: "second" }],
    [{ id: "none", url: "wss://none.example", state: "draining", credentialSecretId: "secret" }],
    [{ id: "missing-secret", url: "wss://valid.example", state: "active" }],
    [{ id: "bad-weight", url: "wss://valid.example", state: "active", credentialSecretId: "secret", weight: 0 }]
  ]) {
    assert.throws(() => parseLiveKitProjects(JSON.stringify(projects)));
  }
});

test("registry diagnostics expose only operational fields", () => {
  const registry: LiveKitProjectRegistry = parseLiveKitProjects(projectJson);
  const diagnostics = registry.diagnostics();

  assert.deepEqual(diagnostics, [
    { id: "eu-primary", endpointHost: "eu-primary.livekit.cloud", region: "eu-central", state: "active" },
    { id: "eu-draining", endpointHost: "eu-draining.livekit.cloud", region: "eu-central", state: "draining" }
  ]);
  assert.equal(JSON.stringify(diagnostics).includes("credentialSecretId"), false);
});
