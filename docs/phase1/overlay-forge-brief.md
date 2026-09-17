# Learning Guide × Overlay / Forge

产品仓是 `First-Light-TechHK/LearningGuidePortal`。工具仓是 `LibertychaserUS/AIOps`。发布针：`overlay-v2.0.0` / `forge-v1.1.3`。不要 pin `main`。不要 vendor `overlay/` 或 `forge/`。

**Overlay I/O 是规格黑盒，一般来说肯定是对的。** 叶子说没有 `exists` / 没有 `resetUrl` / 取消后再 complete 必须 400 时，测试红说明产品漏了。不改测试、不改 cases。要绿，改产品。

## 现在是什么

- Overlay 状态只有 `active` | `blocked`。没有 `armed` / `draft` / `reviewed_by`。
- **`inbox/` 是 Overlay 入口，不是 Forge。** Forge 的 `docs_sync` 只是盯着 `inbox/**` `suites/**` `invariants.yaml` `overlay.yaml` `forge.yaml`：改这些文件必须同步本 brief。那不是在 LG 上新增 Forge Ruleset。
- `overlay.yaml`：`product.repo` 是本仓；`default_ref` 钉在 `ec9e12990fa700b034829fd2fd4af12d955bd40e`；`branches` 含 `main` / `default`；`never_red_statuses: [blocked]`。
- 七套件 `active`：login / payment / portal / my-learning / order / visitor-trial / course-management。`schema: overlay-suite/v2`。`inbox/` 仍是 Overlay，不是 Forge。
- `overlay-check.yml`：checkout `AIOps@overlay-v2.0.0` → `_aiops`，`overlay validate` + `cover` + `run`。不要把 `test:io` 加进 Verify。
- `forge-check.yml`：checkout `AIOps@forge-v1.1.3` → `_aiops`，`forge check` + `forge status --check-state`。
- `forge.yaml`：`protect: [main]`；required_checks = Typecheck / Lint / Build and test / overlay-check / forge-check。第一次不设 `deny_paths`。这次不改 `forge.yaml`，不 `forge apply`。
- `tests/io/*` 是 Overlay `product_command`。**不在** `test:ci` 里。`course-management` 的 I/O 是 `tests/io/course-management.test.ts`。
- `docs/STATE.md` 由 `forge status --write` 生成，不要手改。

## 课程上传：CI / Overlay

第七套 `course-management` 已 `active`。overlay-check 会跑 `tests/io/course-management.test.ts`。不要把 `test:io` 加进 Verify。

产品已对上叶子：栅格 sharp 整图 decode（16 MP，动画 GIF 拒）；封面必须是本课 image asset；新写 COS/HTTPS 封面 400；历史 HTTPS 只在 read `sanitiseLessonContents`；已发布课程页 / public-lesson 不对游客 redirect；`data-instance-content` 删除后 `data-instance-src` 保留展品 URL；trial 停点用 `data-trial-stop` / `data-instance-type="3"`，不写死 `<Exh 3>`。

仍不在 Verify 的：ffmpeg、杀毒、孤儿 `.bin` GC、`scripts/test-lgteacher-complete.ts`。视频/音频只验容器——写明的上限。

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
7. 不把 Overlay I/O 写进 Verify / `test:ci`。
8. 不改 `forge.yaml`，不 live-apply Ruleset，不代签 `reviewed_by` / `armed`。
