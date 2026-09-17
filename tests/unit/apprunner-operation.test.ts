import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findOperation,
  formatOperationId,
  interpretDeployProgress,
  normalizeOperationId,
} from "../../scripts/apprunner-operation.mjs";

test("start-deployment hyphenless OperationId matches list-operations UUID Id", () => {
  const started = "d5154d97103341aeaf55439c14a95f7a";
  const listed = "d5154d97-1033-41ae-af55-439c14a95f7a";
  assert.equal(normalizeOperationId(started), normalizeOperationId(listed));
  assert.equal(formatOperationId(started), listed);
  assert.equal(findOperation([{ Id: listed, Status: "IN_PROGRESS" }], started)?.Status, "IN_PROGRESS");
  assert.equal(findOperation([{ Id: listed, Status: "SUCCEEDED" }], started)?.Status, "SUCCEEDED");
  assert.equal(findOperation([{ Id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Status: "SUCCEEDED" }], started), null);
});

test("exact string match of the raw start-deployment id misses the listed operation", () => {
  const started = "d5154d97103341aeaf55439c14a95f7a";
  const listed = [{ Id: "d5154d97-1033-41ae-af55-439c14a95f7a", Status: "SUCCEEDED" }];
  assert.equal(listed.find((operation) => operation.Id === started), undefined);
  assert.equal(findOperation(listed, started)?.Status, "SUCCEEDED");
});

test("empty operation status waits; AccessDenied plus RUNNING after busy is a fallback success", () => {
  assert.equal(interpretDeployProgress({ operationStatus: "", serviceStatus: "RUNNING" }).action, "wait");
  assert.equal(interpretDeployProgress({
    operationStatus: "",
    serviceStatus: "OPERATION_IN_PROGRESS",
    listError: "AccessDeniedException",
  }).action, "wait");
  const fallback = interpretDeployProgress({
    operationStatus: "",
    serviceStatus: "RUNNING",
    seenBusy: true,
    listError: "AccessDeniedException: User is not authorized to perform: apprunner:ListOperations",
  });
  assert.equal(fallback.action, "success");
  assert.match(fallback.reason, /list-operations unavailable/);
});

test("FAILED and undeployable service statuses fail; SUCCEEDED wins", () => {
  assert.equal(interpretDeployProgress({ operationStatus: "FAILED", serviceStatus: "OPERATION_IN_PROGRESS" }).action, "fail");
  assert.equal(interpretDeployProgress({ operationStatus: "ROLLBACK_FAILED", serviceStatus: "RUNNING" }).action, "fail");
  assert.equal(interpretDeployProgress({ operationStatus: "", serviceStatus: "PAUSED" }).action, "fail");
  assert.equal(interpretDeployProgress({ operationStatus: "SUCCEEDED", serviceStatus: "RUNNING" }).action, "success");
});
