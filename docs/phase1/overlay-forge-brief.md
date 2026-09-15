# Learning Guide × Overlay / Forge

产品仓是 `First-Light-TechHK/LearningGuidePortal`。工具仓是 `LibertychaserUS/AIOps`。发布针：`overlay-v2.0.0` / `forge-v1.1.3`。不要 pin `main`。不要 vendor `overlay/` 或 `forge/`。

**Overlay I/O 是规格黑盒，一般来说肯定是对的。** 叶子说没有 `exists` / 没有 `resetUrl` / 取消后再 complete 必须 400 时，测试红说明产品漏了。不改测试、不改 cases。要绿，改产品。

## 现在是什么

- Overlay 状态只有 `active` | `blocked`。没有 `armed` / `draft` / `reviewed_by`。
- `overlay.yaml`：`product.repo` 是本仓；`default_ref` 钉在 `ec9e12990fa700b034829fd2fd4af12d955bd40e`；`branches` 含 `main` / `default`；`never_red_statuses: [blocked]`。
- 六套件 `active`：login / payment / portal / my-learning / order / visitor-trial。`schema: overlay-suite/v2`。
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

## 提交到 First-Light `main`（已准备好，人开 PR）

比较：https://github.com/First-Light-TechHK/LearningGuidePortal/compare/main...LibertychaserUS:LearningGuidePortal:cursor/lg-upstream-of-9bdf

头：`LibertychaserUS:cursor/lg-upstream-of-9bdf`  
底：`First-Light-TechHK:main`

本包 tip：`1f2b215`（另有 brief 提交时以 HEAD 为准）。pin 已发布针 `overlay-v2.0.0` / `forge-v1.1.3`，六套 `active`，`forge.yaml` 只保护 `main`。不直推 `upstream`。不合入。不 live-apply。合入后由人持 `FORGE_GITHUB_TOKEN` 对本仓 `forge.yaml` 跑 `forge apply`，才会出现 GitHub Ruleset。

下面整段可粘进源仓 draft PR。

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
- 六套 `active`（`overlay-suite/v2`）：login / payment / portal / my-learning / order / visitor-trial。inbox / cases / invariants 同步。
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

不改 Verify / `test:ci`。不 vendor `overlay/` `forge/`。不 pin `main`。不改密码重置 / 订阅展示 / 微信绑邮箱产品。不直推 `main`。不 live-apply。不改规格叶子去迁就现状。

## 分工

开 PR：人（比较链）。审：人。合 `main`：人。`forge apply` 保护 `main`：人 / `$manage-repo`。agent 不推 `upstream`、不合入、不 apply。
```

## 刻意没做的

1. 不改 Verify，不把 `test:io` 加进 `test:ci`。
2. 不 vendor 工具，不 pin `AIOps` 的 `main`。
3. 不把 fork 的 `dev` / promote 抄进本仓。
4. 不改密码重置、订阅展示、微信绑邮箱等产品代码。
5. 不把规格叶子改成迁就 `exists`、`resetUrl`、503、或第二次 complete。
6. 第一次不设 `deny_paths`（本单必须改 workflow）。
