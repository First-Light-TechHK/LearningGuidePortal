# Learning Guide：开发代理规则

本文件是开发人员和 AI coding tool 的强制入口。开始修改代码前，必须先阅读：

1. `docs/phase1/requirements-map.md`
2. `docs/phase1/domain-model.md`
3. `docs/phase1/api-contracts.md`
4. `docs/phase1/release-runbook.md`
5. `DESIGN.md`
6. `docs/phase1/overlay-forge-brief.md` — Overlay / Forge 入口。先读 `docs/STATE.md`（生成，不要手改）和 `docs/phase1/overlay-forge-issues.md`。本地只 pin 已发布 tag：`overlay-v2.0.0`（Overlay）/ `forge-v1.1.3`（Forge）；同一仓、两件产品，不要手抄 SHA。不要 pin `main`。不要 force-move 旧针。不要 vendor `overlay/` 或 `forge/`。A 路线：`forge check` 绿之后 PR 打到 `dev`（CI required，无人批）；`dev → main` 由 `forge promote`（1 人批 + CODEOWNERS，merge commit）。套件状态只有 `active | blocked`，没有 `armed`，没有 `reviewed_by`；人审是 PR 审批 + CODEOWNERS。Agent 不得把套件改成 `blocked`（`suite_guard`），不得改 `.github/workflows/`（`deny_paths`）。`docs_sync` 在本地 `forge check` 和 CI `forge-check` 都会跑。不要把 `test:io` 加进 Verify。不要打 `ilovelearningguide.com`。不要改 Verify。

本仓已有 native skills（不要 vendor 工具仓 Python）：`use-forge`（开发冷启动六步，无 live apply）、`use-overlay`、`design-cases`、`dev-pr`、`manage-repo`。标准路径：

- `.agents/skills/`（Codex / 多 host 共用）
- `.cursor/skills/`
- `.claude/skills/`

Canonical：`docs/phase1/skills/<name>/SKILL.md`。或从已发布 tag 装工作本（host id：`codex` / `cursor` / `claude-code` / `github-copilot`）：

```text
# overlay-v2.0.0 / forge-v1.1.3 — 官方针，现状见 docs/STATE.md
gh skill install LibertychaserUS/AIOps --agent cursor --pin overlay-v2.0.0 --all
gh skill install LibertychaserUS/AIOps use-forge --agent cursor --pin overlay-v2.0.0
gh skill install LibertychaserUS/AIOps use-overlay --agent cursor --pin overlay-v2.0.0
gh skill install LibertychaserUS/AIOps design-cases --agent cursor --pin overlay-v2.0.0
gh skill install LibertychaserUS/AIOps dev-pr --agent cursor --pin overlay-v2.0.0
gh skill install LibertychaserUS/AIOps manage-repo --agent cursor --pin overlay-v2.0.0
gh skill install . --from-local --all --allow-hidden-dirs --agent cursor
```

本仓 `$use-forge` 是开发冷启动：`forge check` 绿之后 PR 打到 `dev`；`dev → main` 走 `forge promote`。live `apply` 只在 `$manage-repo`，由 Oliver 持 `FORGE_GITHUB_TOKEN` 在 fork 的 `dev`+`main` 上执行；agent 不做。`docs_sync` 在本地 `forge check` 和 CI `forge-check` 都会跑。针脚与 Ruleset 现状只看 `docs/STATE.md`。已发布针记录见 `docs/phase1/aiops-release/APPLY.md`。

```text
git clone https://github.com/LibertychaserUS/AIOps.git /tmp/AIOps
git -C /tmp/AIOps checkout overlay-v2.0.0
# Forge CLI 用 forge-v1.1.3（同一仓、另一件产品）
python3 -m pip install -r /tmp/AIOps/requirements.txt
export PYTHONPATH=/tmp/AIOps
python3 -m overlay validate --root .
python3 -m overlay cover --root .
python3 -m forge check --root .
python3 -m forge status --root . --repo LibertychaserUS/LearningGuidePortal --check-state
```

需要 CPython 3.12+。`python -m forge` 子命令以工具仓 `docs/cli.md` 为准；开发侧用 `check` / `submit` / `promote`；Ops 才 `apply` / `release`。没有 `brief` / `credential` / `ops-chain` / `revoke`。`required_checks` 用本仓 CI **job 名**：`Typecheck` / `Lint` / `Build and test` / `overlay-check` / `forge-check`（不要抄 workflow 名 `Verify`）。叶子标题必须是 `### Functional` / `### Negative` / `### Edge`；不要写 `### Depth` 或 `## Specified`。`function_id` 全局唯一；invariant 必须对上 `##` 标题。已有的 `overlay-check.yml` 是单 job `overlay-check`（checkout `AIOps@overlay-v2.0.0` 到 `_aiops`、`npm ci`、`overlay validate` + `cover` + `run`）；另有 `forge-check.yml`（checkout `AIOps@forge-v1.1.3` 到 `_aiops`、`forge check` + `forge status --check-state`）。两者都在 `deny_paths`（`.github/workflows/`），agent 不改。已知问题与待定意图见 `docs/phase1/overlay-forge-issues.md`。

Forge 是开发完成后的 GitHub 落地（`check` → PR 到 `dev` → `promote` 到 `main`），不是测试工具，不改 Overlay / Verify。本仓已有 `forge.yaml`：问一次是否按 Forge 落地；同意后说「之后默认按 Forge 落地」，然后默认跑 `check`，持有 `FORGE_SUBMIT_TOKEN` 再 `submit` 到 `dev`，不要每次存盘再讲宪法。初始化同意 ≠ live-apply Ruleset，也不等于把套件改成 `blocked`。`FORGE_SUBMIT_TOKEN` 与 `FORGE_GITHUB_TOKEN` 是 Oliver 提供的环境密钥，agent 永不粘贴 token。若接入方还没有 Forge、且已有自己的落地方式，必须先对照新旧并等人明确同意，不能默默替换。

## PR 审查（云 agent 的两项职责）

1. **正文与 diff 逐条对账。** 审 PR 先读六标题正文，再读 `git diff --stat` 与关键文件，逐条核对「做了什么」：正文写了、diff 没有 → 要求删或补；diff 有、正文没写 → 要求补写（尤其是 `.github/workflows/`、套件 `status`、`forge.yaml` / `overlay.yaml`、迁移、依赖）。对不上的 PR 不批、不合，评审意见里列出不对应的条目。开 PR 的 agent 反过来同样：正文必须从 diff 写出来，不许复制模板空话。
2. **维护全局上下文，尤其是文档。** 审 PR 时确认这次改动把该带的上下文一起带了：`docs/STATE.md`（配置 / 工作流 / 保护分支变了要重新生成）、`docs/phase1/overlay-forge-issues.md`（新问题登记、状态改动）、`docs/phase1/overlay-forge-brief.md`（`docs_sync` 表要求）、ADR（契约变更）、工具仓 `CHANGELOG.md`（工具变更）。缺了就在评审里点名到文件；agent 可以提交文档修正，但不替作者改实现。`forge check` 的 `docs_sync` / `--check-state` 只能查机器能判定的部分，剩下的靠这一条。内容包按层配对是补设计（brief §5 / OF-23，待接受）：改了 suites / 配置必须带已有 `docs_sync` 要求的 brief；agent 包不得带 `.github/workflows/`。不是每个 PR 都要同时交文档 + 代码 + workflow。新合入规则先设计后实现；未接受前不加新锁。

## 项目边界

- 这是 Learning Guide Phase 1 生产网站，不是 KS 产品。
- 功能范围只来自七份 PRD：My Learning、Order Management、Payment Management、Portal、Registration & Authentication、Subscription Management、Visitor / Trial。
- KS 是 Study、Understanding/Assessment、AI Tutor 的组成部分。KS Phase 2 可以并行开发，但不能改变 Phase 1 的购买、账户、课程访问和上线链路。
- 旧 Java/Vue 项目只用于核对已有行为和数据，不作为新的部署目标。

## 架构规则

- 只有一个 Next.js 应用，页面和 API Route Handler 在同一仓库、同一部署单元。
- 四个正式环境：DEV、SIT、UAT、PPE/PROD。每个环境是一个 AWS App Runner 服务，使用同一镜像结构和不同配置。
- Cloud 只使用当前约定的轻量服务：App Runner、RDS PostgreSQL、S3、Secrets Manager、CloudWatch、SES；需要外部能力时使用 Stripe、Google、WeChat、OpenRouter。
- 不为每个 Business Function 创建微服务。用 `modules/<business-function>` 隔离代码，用 `services` 处理跨模块流程，用 `repositories` 统一数据访问。
- 浏览器不能决定价格、Order、Payment、Subscription、Entitlement 或 Course 访问权限。所有这些事实由服务端从 PostgreSQL 或受信任的外部回调计算。

## 固定用词

代码、路由、接口文档和页面文案保持图中的词：Role、User Interface、Business Function、Basic Components、Cloud、Channel、Partner；Tourists/Users、Course Manager/Operator；Learning Guide Portal、Learning Guide App、Learning Guide Backoffice Portal；Tourists Visit、User Registration、Purchase、Student Management、Course Management、Study、Understanding/Assessment、Group Study、Order Management、Payment Management、Exploration、AI Tutor、Reporting；User Authentication、Rule Engine、Process Engine、Message Queue、Data Management；Database、Containers、Network、Monitor、Security Strategy。

## 实施要求

- 所有范围内页面均按 `DESIGN.md` 的 Figma 设计依据验收；不能把 UI 对照范围限制为 Excel/PPT 修改清单。修改清单仅约束其涉及的功能。
- 新功能先写数据类型、服务函数和 API contract，再写页面。
- 每个 Route Handler 只做：解析 request、校验输入、取得 session、调用 application service、返回统一结果。
- 业务规则放在 application service 或 Rule Engine；SQL 只放在 repository；Stripe 只在 Payment Management service 调用。
- 涉及 Order、Payment、Subscription、Entitlement 的写入必须可重复执行；Stripe event id、client event id 等外部幂等键必须有唯一约束。
- UI 和静态内容使用 native i18n，默认 `en-GB`，另有 `zh-CN`。课程正文、字幕和 Stripe 页面不是 UI 翻译文件。
- 每个已实现的用户路径至少有一个服务测试和一个页面/API 集成测试；支付 Webhook、未登录访问、过期 Entitlement、重复 Webhook 必须有失败测试。
- 不提交 `.env`、`.env.local`、Stripe secret、OpenRouter key、OAuth secret 或真实个人资料。

## 完成定义

代码只有同时满足以下条件才算完成：

1. 对应 PRD 条目在 `requirements-map.md` 中有实现位置。
2. API、数据库迁移、页面和测试已提交。
3. `npm run build` 通过。
4. 在目标环境按 `release-runbook.md` 完成冒烟测试。
5. 页面状态、错误信息和跳转路径已覆盖，不以“主流程能打开”作为完成标准。
