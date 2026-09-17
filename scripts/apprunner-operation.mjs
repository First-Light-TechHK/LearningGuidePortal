export function normalizeOperationId(id) {
  return String(id || "").replace(/-/g, "").toLowerCase();
}

export function formatOperationId(id) {
  const hex = normalizeOperationId(id);
  if (hex.length === 32 && /^[0-9a-f]+$/.test(hex)) {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return String(id || "");
}

export function findOperation(list, operationId) {
  const want = normalizeOperationId(operationId);
  if (!want) return null;
  return (list || []).find((operation) => normalizeOperationId(operation?.Id) === want) || null;
}

export function isTerminalSuccess(status) {
  return status === "SUCCEEDED";
}

export function isTerminalFailure(status) {
  return /^(FAILED|ROLLBACK_SUCCEEDED|ROLLBACK_FAILED)$/.test(String(status || ""));
}

export function isBusyService(status) {
  return status === "OPERATION_IN_PROGRESS";
}

const UNDEPLOYABLE = new Set(["PAUSED", "DELETED", "DELETE_FAILED", "CREATE_FAILED"]);

export function interpretDeployProgress({ operationStatus, serviceStatus, seenBusy = false, listError = "" } = {}) {
  if (isTerminalSuccess(operationStatus)) return { action: "success", reason: "operation succeeded" };
  if (isTerminalFailure(operationStatus)) return { action: "fail", reason: `deployment ${operationStatus}` };
  if (UNDEPLOYABLE.has(serviceStatus)) return { action: "fail", reason: `service is not deployable (Status=${serviceStatus})` };
  if (operationStatus === "PENDING" || operationStatus === "IN_PROGRESS" || operationStatus === "ROLLBACK_IN_PROGRESS") {
    return { action: "wait", reason: `operation ${operationStatus}` };
  }
  if (isBusyService(serviceStatus)) return { action: "wait", reason: "service OPERATION_IN_PROGRESS" };
  if (!operationStatus && seenBusy && serviceStatus === "RUNNING") {
    return {
      action: "success",
      reason: listError
        ? "list-operations unavailable; service returned to RUNNING"
        : "operation id not listed; service returned to RUNNING after OPERATION_IN_PROGRESS",
    };
  }
  return { action: "wait", reason: operationStatus ? `operation ${operationStatus}` : "operation status empty" };
}
