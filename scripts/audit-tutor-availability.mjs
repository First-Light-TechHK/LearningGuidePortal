#!/usr/bin/env node
/**
 * AI Tutor 可用性审计（2026-10-28 复盘 A5）。
 *
 * 背景：日志只能反映"调用失败"，无法反映**状态不一致** ——
 * 例如后台把课程设为 Online，但 KS 里没有这门课 / 没有上线版本，
 * 此时 Portal 每次调用都成功（200），只是 available=false，
 * 学员端永远没有入口，日志里看不出来。
 *
 * 本脚本直接按学员视角调用 KS 的 /api/user/ai-tutors，把不一致数量打成
 * CloudWatch 指标 `TutorMismatch`，由 index/tutor 告警链一起监控。
 *
 * 用法（CI 定时任务）：
 *   KS_TUTOR_BASE_URL=https://admin.sit.ilovelearningguide.com \
 *   KS_TUTOR_API_KEY=... node scripts/audit-tutor-availability.mjs
 *
 * 输出：一行 JSON，便于 GitHub Actions 读取后 put-metric-data。
 * 退出码：0 表示检查完成（无论是否发现不一致）；2 表示无法完成检查。
 */

const baseUrl = (process.env.KS_TUTOR_BASE_URL || "").trim().replace(/\/+$/, "");
const apiKey = (process.env.KS_TUTOR_API_KEY || "").trim();

if (!baseUrl) {
  console.error(JSON.stringify({ ok: false, error: "KS_TUTOR_BASE_URL is not set" }));
  process.exit(2);
}

const response = await fetch(`${baseUrl}/api/user/ai-tutors`, {
  headers: apiKey ? { "X-API-Key": apiKey } : undefined,
  cache: "no-store",
  signal: AbortSignal.timeout(15_000),
}).catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
  process.exit(2);
});

if (!response.ok) {
  // 401 在这里通常意味着 Portal 的 KS_TUTOR_API_KEY 与 KS 的 AUTH_TOKEN 不一致。
  console.error(JSON.stringify({ ok: false, status: response.status, error: "KS rejected the audit request" }));
  process.exit(2);
}

const payload = await response.json();
const tutors = Array.isArray(payload?.data) ? payload.data : [];

/** online=true 但 available=false：后台开了开关，学员端却看不到入口。 */
const mismatches = tutors.filter((t) => t?.online === true && t?.available !== true);
const available = tutors.filter((t) => t?.available === true);

console.log(JSON.stringify({
  ok: true,
  total: tutors.length,
  available: available.length,
  mismatch: mismatches.length,
  // 只输出 externalId 与原因，便于在告警描述里定位，不含任何密钥
  mismatchCourses: mismatches.map((t) => t.externalId || t.courseId),
}));
