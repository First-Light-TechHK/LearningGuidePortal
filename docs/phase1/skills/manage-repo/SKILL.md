---
name: manage-repo
description: >-
  Oliver 的 Ops 动作：用 FORGE_GITHUB_TOKEN 对 fork 的 dev+main 跑 forge apply、
  批准 promote PR、点 AIOps release workflow。不要替开发 forge submit（用 dev-pr）。
  Agent 不得使用本 skill 去做这些事。
metadata:
  short-description: Oliver Ops：apply、批 promote、release；agent 永不做
---

# Manage Repo（Learning Guide）

**本 skill 只给 Oliver。Agent 不得执行下面任何一步。**

审和合在 **GitHub**。权威步骤见工具仓 [manage-repo](https://github.com/LibertychaserUS/AIOps/blob/forge-v1.1.3/skills/manage-repo/SKILL.md)。路径：[dev-main-flow.md](https://github.com/LibertychaserUS/AIOps/blob/forge-v1.1.3/docs/dev-main-flow.md)。配置：[forge-config.md](https://github.com/LibertychaserUS/AIOps/blob/forge-v1.1.3/docs/forge-config.md)。入口：[`AGENTS.md`](../../../../AGENTS.md)、[`overlay-forge-brief.md`](../../overlay-forge-brief.md)、[`APPLY.md`](../../aiops-release/APPLY.md)。

`FORGE_GITHUB_TOKEN`（Ruleset / apply）和 `FORGE_SUBMIT_TOKEN`（代推）是两把钥匙，都由 Oliver 配成环境密钥。agent 永不粘贴。

## Instructions

1. **`forge apply`（Oliver，持 `FORGE_GITHUB_TOKEN`）**，对 fork 的 `dev`+`main`。必须 `--path` 指向**本仓** `forge.yaml`（在本仓根执行）。不要在 AIOps 工具仓根对 LG `--repo` apply（会写入工作本的 `pr-title` / `sop-lock` / `unittest`）。不要从 Overlay CI 跑 live apply。agent 不做。

```text
PYTHONPATH=/tmp/AIOps python3 -m forge apply --repo LibertychaserUS/LearningGuidePortal --path forge.yaml --dry-run
PYTHONPATH=/tmp/AIOps python3 -m forge apply --repo LibertychaserUS/LearningGuidePortal --path forge.yaml
PYTHONPATH=/tmp/AIOps python3 -m forge status --repo LibertychaserUS/LearningGuidePortal --root . --write docs/STATE.md
```

每个保护分支一条 `forge-protected-<branch>`，另加 `forge-protected-tags`。AIOps 工具仓自己也要 apply，用 **AIOps** 的 `forge.yaml`（见 [`overlay-forge-issues.md`](../../overlay-forge-issues.md) OF-08）。

2. **Required checks** 是 PR 上的 **CI job 名**：`Typecheck` / `Lint` / `Build and test` / `overlay-check` / `forge-check`。不要抄 workflow 名 `Verify`。`dev` 无人批；`main` 要 1 个 approvals + CODEOWNERS。

3. **Merge 进 `dev`：** CI 绿即可（approvals=0）。**Merge 进 `main`：** 只合 `forge promote` 开出的 PR，1 人批 + CODEOWNERS，merge commit。不要让 agent merge。不要替开发 `forge submit`（那是 `$dev-pr`）。

4. **Promote：** `dev` → `main` 由 `forge promote --repo LibertychaserUS/LearningGuidePortal --from dev --to main` 开 PR。人批 + 合。命令本身永不 merge。

5. **Overlay `blocked`** 是人手改 yaml。Agent 不得在 agent 分支上做（`suite_guard` 红）。`blocked` 必须有带链接或编号的 `blocked_reason`。不要写已删除的旧字段。改完：`PYTHONPATH=/tmp/AIOps python3 -m overlay validate --root .`（针 `overlay-v2.0.0`）。

6. **审 PR 的两项职责（人和审查 agent 都适用）。** 一、正文与 diff 逐条对账：「做了什么」每条能在 `git diff --stat` 里找到；diff 里的工作流 / 套件 `status` / 配置 / 迁移改动正文必须写；对不上 → request changes，列出条目。二、全局上下文：`docs/STATE.md` 是否随配置重生成；[`overlay-forge-issues.md`](../../overlay-forge-issues.md) 是否登记 / 改状态；brief 是否按 `docs_sync` 表同步；契约变更有没有 ADR；工具仓改动有没有 `CHANGELOG.md`。缺就点名到文件再批。规则出处：[`AGENTS.md`](../../../../AGENTS.md) §PR 审查。内容包按层配对是补设计（brief §5 / OF-23，待接受）：agent 包不得带 `.github/workflows/`；升针不要和功能切片混在一单。未接受前不要加新锁。先设计后实现。

7. **AIOps 发布：** 已发布 tag 的 GitHub Release 页已补齐（`overlay-v1.0.1`…`overlay-v2.0.0`，`forge-v1.0.1`…`forge-v1.1.3`）。新 semver 仍走 `forge release` / `release` workflow。不要 force-move。不要拿 Latest 徽章当针（可能仍是 `forge-v1.0.0`）。官方针 `overlay-v2.0.0` / `forge-v1.1.3`。记录见 [`APPLY.md`](../../aiops-release/APPLY.md)。

## Never

- Agent 不得 live-apply、不得批 promote PR、不得点 release、不得粘贴 token。
- 不要改 Verify。不要把 `test:io` 加进 Verify。
- 不要让 agent 把套件改成 `blocked`。
- 不要打 `ilovelearningguide.com`。
- 不要 vendor `forge/` / `overlay/`。
- 不要 `forge submit` 替开发。

## Examples

```text
# 仅 Oliver
PYTHONPATH=/tmp/AIOps python3 -m forge apply --repo LibertychaserUS/LearningGuidePortal --path forge.yaml --dry-run
PYTHONPATH=/tmp/AIOps python3 -m forge promote --repo LibertychaserUS/LearningGuidePortal --from dev --to main --dry-run
PYTHONPATH=/tmp/AIOps python3 -m forge status --repo LibertychaserUS/LearningGuidePortal --root . --write docs/STATE.md
```

合入 main：GitHub PR 页，promote PR，检查绿，1 人批 + CODEOWNERS，merge commit。

## Performance Notes

`forge apply` 是按名 GET + POST/PUT。Overlay `blocked` 是 yaml 编辑 + 本地 validate。无模型。

## Troubleshooting

| 现象 | 处理 |
|---|---|
| Agent 想执行本 skill | 拒。这些是 Oliver 的 Ops。 |
| `promote` 想顺手 merge | 停。命令永不 merge。 |
| Agent 代写 `blocked` | 拒收。自己写 reason 链接。 |
| required_checks 抄了 Verify | 改回 job 名 Typecheck / Lint / Build and test / overlay-check / forge-check。 |
| STATE 不新鲜 | `forge status --write docs/STATE.md`。 |
| 想发下一版 tag | Oliver 点 AIOps `release` workflow。不要 force-move。 |
