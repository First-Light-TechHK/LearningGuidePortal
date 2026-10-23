export function persistenceEnabled() {
  // Accept either explicit backend flag or both required targets.
  const flagged = (process.env.STORAGE_BACKEND || "").trim().toLowerCase();
  const hasDb = Boolean(process.env.DATABASE_URL?.trim());
  const hasBucket = Boolean(process.env.DATA_S3_BUCKET?.trim());
  if (flagged === "local" || flagged === "fs" || flagged === "filesystem") return false;
  return hasDb && hasBucket;
}

export function dataS3Bucket() {
  const bucket = process.env.DATA_S3_BUCKET?.trim();
  if (bucket) return bucket;
  // `next build` prerenders pages without runtime secrets. Media resolution is
  // request-time only; a build placeholder keeps prerender from failing.
  if (process.env.NEXT_PHASE === "phase-production-build") return "build-placeholder";
  throw new Error("DATA_S3_BUCKET is not configured");
}

export function dataS3Prefix() {
  return (process.env.DATA_S3_PREFIX || "app").replace(/^\/+|\/+$/g, "");
}

export function awsRegion() {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-southeast-1";
}
