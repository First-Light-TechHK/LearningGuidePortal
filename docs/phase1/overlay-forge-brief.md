# Learning Guide × Overlay / Forge

产品仓是 `First-Light-TechHK/LearningGuidePortal`。工具仓是 `LibertychaserUS/AIOps`。发布针：`overlay-v2.0.0` / `forge-v1.1.3`。不要 pin `main`。不要 vendor `overlay/` 或 `forge/`。

Overlay I/O failures require a diagnosis against the current contract. Confirm that fixtures reach the behaviour under test, fix product defects, and keep concurrency and security assertions. A fixture correction must be explained and must not relax the invariant merely to make a check pass.

## UAT incident safeguards (30 September 2026)

- `overlay.yaml` explicitly selects `functional` and `regression` for `main`, `dev`, `sit`, `uat` and `ppe`, with the same `default` fallback. The six existing active suites remain selected. This makes the intended environment-branch scope explicit; it does not activate the deferred standalone `concurrency` or `agent` kinds. Concurrent-registration checks remain part of the active functional login suite.
- AUTH-05 was reproduced locally on the `uat` branch; its registration handler matched `origin/sit`: 25 login I/O tests passed and the concurrent test returned 400 instead of 200. Both request fixtures were valid. `registerUserAttempt` serialised account creation correctly, but both handlers continued into initial verification-token issuance. The duplicate encountered `VERIFICATION_COOLDOWN`, which the handler mapped to generic `REGISTRATION_FAILED` (400).
- `app/api/auth/register/route.ts` now returns an accepted, session-free response for an existing pending account. Only the request that creates the account issues its initial token and, in local automatic-verification mode, its session. Existing active-account navigation remains intact. Resending remains an explicit action through the resend endpoint.
- `tests/io/login.test.ts` retains the two HTTP-200 assertions and exactly one working password, and extends coverage to two/three parallel submissions, normalised email variants, session ownership, rejected competing passwords and protected purchase access. A mocked-mail pending-account case checks one initial email, no pre-verification session, preservation of the original token after the cooldown, single-use verification and preservation of the winning password. No real mail is sent.
- These tests use a disposable local store and exercise Route Handlers. They do not establish PostgreSQL multi-instance concurrency, external mail delivery or deployed UAT acceptance. Overlay selection is separate from workflow triggers and branch protection; this change does not claim either has been applied remotely.
- Validation commands: `npm run typecheck:io`; `npm run test:io`; `node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test tests/unit/entitlement-and-auth.test.ts`. Release and live-acceptance evidence remain separate gates.
- Initial validation passed 82 I/O tests and nine auth/entitlement unit tests. Correcting the AUTH-01 fixtures exposed an additional resend contract conflict, resolved below. Final local and remote test counts belong to the release evidence, not this historical diagnostic note.
- The older `registerPending` helper used unsupported `EMAIL_DELIVERY=discard`; setup actually returned 503, allowing two AUTH-01 tests to compare missing accounts instead of pending accounts. The helper now uses mocked SMTP and asserts HTTP 200, exactly one persisted pending user with an unverified email, one captured verification email and no session. Both callers retain their security assertions; the pending-login test also checks the anonymous user and denied purchase access. The mail transport and environment are restored after each test; no real email is sent.
- Contract decision: preserve the current Phase 1 email-first contract in `api-contracts.md` and `requirements-map.md`, including the 429 resend cooldown and daily cap. The older suite's account-existence confidentiality assertion contradicts that contract and the intentional `check-email` existence response. The suite and resend regression now explicitly test the current contract, bounded retryAfter, no additional email, no session and no token disclosure. This is a documented test-contract correction, not a claim that these public endpoints prevent email enumeration. Pending-login response parity and concurrent password-ownership assertions remain unchanged.
- UAT release tooling now requires the latest successful Verify, Overlay and Forge push runs and their required jobs for the exact branch revision. CLI and workflow releases execute the same SIT-reference catalogue/media and authenticated-browser acceptance runner. A receipt records failures as well as successes. The runtime pins archived curriculum media to reviewed S3 object versions in `deploy/uat-course-media.json`; changing a source object cannot silently replace the pinned UAT asset.
- The concise AUTH-05 SMTP-outage regression creates a pending account with asserted setup, ages its token beyond the cooldown and makes any SMTP transport creation fail. Duplicate registration must still return the accepted pending response without a session and leave the stored user and token unchanged. This regression passes.

## Study Group PostgreSQL proofs in the Overlay tree (11 October 2026)

- The `study-group` suite product command now runs the unit suite followed by `scripts/studygroup-io-postgres.sh`, which runs the PostgreSQL io proofs (`tests/io/postgres/*.test.ts`) against a real PostgreSQL 16.
- The script is fail-closed: it uses `DATABASE_URL` when set, otherwise starts and removes a disposable `postgres:16` container via docker, and refuses (non-zero) when neither is available; it never skips silently. Overlay runs therefore need docker on the host unless a DATABASE_URL is provided.
- `trace.yaml` now maps three integration items under SG-03 (`SG-03/persistence/functional|negative|edge`) grounded in the two-process proofs: durable first-wins project assignment and retry reuse; capacity loser `session_full` and occupancy CHECK; two-process first-come-first-served admission, double-seat UNIQUE backstop, append-only token log. The functional item relates to SG-04 (incident reporting of the assigned project).
- Tutor-queue, outbox, reminder and webhook-receipt proofs run inside the same command but have no leaf in cases.md and are therefore not traced.
- The standalone `Study Group PG I/O` workflow keeps its own signal (typecheck + the same script against a service container); the suite command is the one authoritative entrypoint.

### Study Group slice 2–3, the ORDER-02 fix, and the PostgreSQL proof wave (11 October 2026)

- `app/api/livekit/webhook` accepts provider-signed events (raw-body HS256 validation via the SDK receiver, issuer-routed per project) and processes them receipt-first: `study_group_webhook_receipts` is the unique receipt, a crashed delivery stays `received` and is resumed by the retry, a settled duplicate has zero side effects, and no event changes a seat or a session (every verified event settles `ignored`; seats are the server's lease, renewed by `POST /api/study-groups/sessions/{id}/heartbeat`). Webhooks never grant membership or authorization.
- A bounded reconciliation timer (PostgreSQL + provider-verified only) abandons stale receipts past a 300-second/50-row window and repairs presence drift for at most 5 live sessions per 5-minute tick, closing only rows past a 120-second grace whose identity the provider no longer lists.
- Production fail-closed entries: `preflight:production` blocks the file store, a missing or non-32-byte token-log key and a project registry without an active project; `/api/health/config` surfaces `studyGroup.store`; the runtime emits a redacted `study_group.metrics` line (counts only) every five minutes for the runbook's alarm filters.
- `scripts/pg-io-postgres.sh` generalises the disposable-PostgreSQL runner (the study-group wrapper delegates to it), and the payment, visitor-trial and order suites chain their own PostgreSQL proofs; `trace.yaml` gains 11 persistence/webhook/reconcile items (SG-03, SG-04, PAY-03, PAY-05, TRIAL-01, TRIAL-02, ORDER-02).
- The ORDER-02 defect is fixed with a failing test first: a refunded Stripe subscription can no longer be revived by a later renewal `invoice.paid` (the renewal is still recorded — the guard blocks access, not the money fact). `tests/unit/refund-then-invoice.test.ts` (previously cited but absent) now exists, with a two-process companion in `tests/io/postgres/order-persistence.test.ts`.
- Local deterministic evidence for this wave: 467 unit tests, 101 integration tests, 35 PostgreSQL io proofs in one disposable container, `overlay run` 7/7 suites. The deployed non-production smoke and the key-rotation drill remain operational gates (release-runbook §Study Group).

The sections below record the original tool integration and historical expected failures at `ec9e129`; they are not a statement that the current UAT branch is expected to fail.

## 现在是什么

- Overlay 状态只有 `active` | `blocked`。没有 `armed` / `draft` / `reviewed_by`。
- `overlay.yaml`：`product.repo` 是本仓；`default_ref` 钉在 `ec9e12990fa700b034829fd2fd4af12d955bd40e`；`branches` 含 `main` / `dev` / `sit` / `uat` / `ppe` / `default`；`never_red_statuses: [blocked]`。
- 七套件 `active`：login / payment / portal / my-learning / order / visitor-trial / study-group。`schema: overlay-suite/v2`。study-group 的产品命令匹配 `tests/unit/study-group-*.test.ts`；除了 Group 与 Live Session 行为，也覆盖 LiveKit 项目配置、Secrets Manager 凭据解析、红脱敏权限健康探测和缓存契约。真实 Cloud smoke 仍只在获授权的非生产环境执行。
- `overlay-check.yml`：checkout `AIOps@overlay-v2.0.0` → `_aiops`，`overlay validate` + `cover` + `run`。不要把 `test:io` 加进 Verify。
- `forge-check.yml`：checkout `AIOps@forge-v1.1.3` → `_aiops`，`forge check` + `forge status --check-state`。
- `forge.yaml`：`protect: [main]`；required_checks = Typecheck / Lint / Build and test / overlay-check / forge-check。第一次不设 `deny_paths`。
- `tests/io/*` 是 Overlay `product_command`。**不在** `test:ci` 里。
- `docs/STATE.md` 由 `forge status --write` 生成，不要手改。

## 规格红（预期，直到产品改）

这些叶子两边相同。fork 上绿。本树 `ec9e129` 上红是产品，不是测试写错：

| 叶子 | 规格 | 本树现状 |
|---|---|---|
| AUTH-01 | `POST /api/auth/check-email` 无 `exists`；已知/未知同一公开 JSON | 回 `{ exists: true\|false }` |
| AUTH-02 | `POST /api/auth/password-reset/request` HTTP 200，`ok: true`，无 `resetUrl` / `token` | 无邮件时 503 `email_unavailable`；DEV preview 会漏 `resetUrl` |
| PAY-10 / TRIAL-02 | 取消后再 complete 必须 400；已购后再 trial 必须 400 | 再 complete 200；已购后再 trial 502 |

不要把这些断言改成迁就现状。

## 提交到 First-Light `main`（2026-09-15 Oliver：源仓未 apply，快进 `main`，不开 PR）

本包 pin 已发布针 `overlay-v2.0.0` / `forge-v1.1.3`，六套 `active`，`forge.yaml` 只保护 `main`。不 live-apply。Ruleset 仍要人持 `FORGE_GITHUB_TOKEN` 对本仓 `forge.yaml` 跑 `forge apply` 才会出现。

落地说明（不是源仓 PR 正文；源仓这次不开 PR）：

标题：

```text
feat: land Overlay 2.0.0 and Forge 1.1.3 with spec I/O
```

正文：

```text
## 做了什么

- 新增 `forge.yaml`：`protect: [main]`；required_checks = Typecheck / Lint / Build and test / overlay-check / forge-check。第一次不设 `deny_paths`。
- 新增 `.github/workflows/forge-check.yml`：pin `forge-v1.1.3`，跑 `forge check` + `forge status --check-state`。
- 改 `.github/workflows/overlay-check.yml`：pin `overlay-v2.0.0`，`validate` + `cover` + `typecheck:io` + `run`。不改 Verify，不把 `test:io` 加进 `test:ci`。
- 改 `overlay.yaml`：`product.repo` = First-Light；`default_ref` = `ec9e129`；`never_red_statuses: [blocked]`。
- 七套 `active`（`overlay-suite/v2`）：login / payment / portal / my-learning / order / visitor-trial / study-group。inbox / cases / invariants 同步。study-group → `tests/unit/study-group-*.test.ts`。
- `package.json` 只加 `typecheck:io` 与 `test:io`。新增 `tsconfig.io.json`、`docs/STATE.md`、本 brief。
- 已有 `tests/io/login.test.ts` / `payment.test.ts` 断言不动；0 参 `GET` 只套 `callRoute`。补 portal / order / my-learning / visitor-trial I/O。
- 按 `7f42330` / `ec9e129` 补 reset confirm、email-binding、subscription portal 的公开 JSON 锁。不改 `app/` `services/`。

## 为什么

源仓 Overlay 仍是 v1 / `armed` / 四套。fork 已是 v2 / `active` / 六套。回灌只带 Forge + Overlay + 规格黑盒测试，不搬产品。套件 `active` 后 overlay-check 会跑叶子；产品漏 `exists` / 503 / 第二次 complete 必须红，不改测试。

## 动了哪些门

overlay-check、forge-check

## 怎么验

```text
PYTHONPATH=/tmp/AIOps python3 -m overlay validate --root .
PYTHONPATH=/tmp/AIOps python3 -m overlay cover --root .
PYTHONPATH=/tmp/AIOps python3 -m forge check --root . --title "feat: land Overlay 2.0.0 and Forge 1.1.3 with spec I/O"
npx tsc --noEmit -p tsconfig.io.json
```

六套 `active` 都会入选。预期 overlay-check 红：AUTH-01 `exists`、AUTH-02 无邮件 503、PAY-10 / TRIAL-02。要绿改产品。合入后：`python3 -m forge apply --repo First-Light-TechHK/LearningGuidePortal --path forge.yaml`（人，持 `FORGE_GITHUB_TOKEN`）。

## 不做什么

不改 Verify / `test:ci`。不 vendor `overlay/` `forge/`。不 pin AIOps `main`。不改密码重置 / 订阅展示 / 微信绑邮箱产品。不 live-apply。不改规格叶子去迁就现状。这次源仓未 apply，Oliver 授权快进 `main`、不开 PR。

## 分工

快进 `main`：agent（Oliver 2026-09-15 授权，因源仓未 apply）。`forge apply` 保护 `main`：人 / `$manage-repo`。agent 不 apply。
```

## 刻意没做的

1. 不改 Verify，不把 `test:io` 加进 `test:ci`。
2. 不 vendor 工具，不 pin `AIOps` 的 `main`。
3. 不把 fork 的 `dev` / promote 抄进本仓。
4. 不改密码重置、订阅展示、微信绑邮箱等产品代码。
5. 不把规格叶子改成迁就 `exists`、`resetUrl`、503、或第二次 complete。
6. 第一次不设 `deny_paths`（本单必须改 workflow）。
