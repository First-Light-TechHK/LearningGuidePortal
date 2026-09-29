---
name: use-forge
description: >-
  Learning Guide 开发冷启动：pin overlay-v2.0.0 / forge-v1.1.3，pip install，
  PYTHONPATH，python -m forge check，再把 PR 打到 dev。promote 与 live apply
  属于 manage-repo。不要合入。check 红不要 submit。agent 不做 apply。
metadata:
  short-description: Forge v1.1 冷启动；submit 到 dev；无 live apply
---

# Use Forge（Learning Guide）

本仓薄操作说明。权威步骤见工具仓 [use-forge](https://github.com/LibertychaserUS/AIOps/blob/forge-v1.1.3/skills/use-forge/SKILL.md)。子命令见 [cli.md](https://github.com/LibertychaserUS/AIOps/blob/forge-v1.1.3/docs/cli.md)。配置见 [forge-config.md](https://github.com/LibertychaserUS/AIOps/blob/forge-v1.1.3/docs/forge-config.md)。路径图见 [dev-main-flow.md](https://github.com/LibertychaserUS/AIOps/blob/forge-v1.1.3/docs/dev-main-flow.md)。

Forge 是开发门：本地 `check`，再 `submit`（draft PR 到 `protect[0]` = `dev`）。不合入。不改 Overlay 套件 `status`。

**本仓已有** `forge.yaml`。不要 vendor `forge/` 或 `overlay/`。live `apply` 只由 Oliver 做（[`manage-repo`](../manage-repo/SKILL.md)）。密钥：工具仓 `docs/submit-credential.md`；`FORGE_SUBMIT_TOKEN` 与 `FORGE_GITHUB_TOKEN` 是环境密钥，agent 永不粘贴。

Pin **已发布** tag：`overlay-v2.0.0` / `forge-v1.1.3`。不要 pin `main`。不要手抄 SHA（现状看 [`docs/STATE.md`](../../../STATE.md)）。

入口：[`AGENTS.md`](../../../../AGENTS.md) 第 6 条和 [`overlay-forge-brief.md`](../../overlay-forge-brief.md) §11。

## Instructions

### 1. Checkout 已发布针

```text
git clone https://github.com/LibertychaserUS/AIOps.git /tmp/AIOps
git -C /tmp/AIOps checkout overlay-v2.0.0
# Forge CLI 用 forge-v1.1.3
```

需要 CPython **3.12+**。

### 2. 装 Python 依赖

```text
python3 -m pip install -r /tmp/AIOps/requirements.txt
export PYTHONPATH=/tmp/AIOps
```

### 3. 沿用本仓 `forge.yaml` 的 job 名

本仓 `required_checks` 是 PR 上的 **CI job 名**：

`Typecheck` / `Lint` / `Build and test` / `overlay-check` / `forge-check`

workflow 名是 `Verify`。不要把 `Verify` 写进 `required_checks`。不要把 `test:io` 加进 Verify。不要改 `.github/workflows/`（`deny_paths`）。

### 4. 不要拷 `forge/`

政策文本在 [`AGENTS.md`](../../../../AGENTS.md)。「贴条文」是**文本**，不是 `git add forge/`。

### 5. 在本仓跑 `forge check`

```text
PYTHONPATH=/tmp/AIOps python3 -m forge check --root . --title "feat: subject"
PYTHONPATH=/tmp/AIOps python3 -m forge status --root . --repo LibertychaserUS/LearningGuidePortal --check-state
```

`check` 会跑 overlay validate / cover、`docs_sync`、`deny_paths`、`suite_guard`。红 → 停。不要 push。不要 submit。

Overlay 契约：[`use-overlay`](../use-overlay/SKILL.md)。

### 6. check 绿之后 PR 打到 `dev`

持有 `FORGE_SUBMIT_TOKEN` 才 `forge submit`。否则走 host 的 PR 路径。见 [`dev-pr`](../dev-pr/SKILL.md)。`dev → main` 用 `forge promote`，永不 merge。永不自批。永不 live-apply。

## Never

- 不要 vendor `forge/` / `overlay/`。
- 不要 pin `main`。不要 force-move 旧针。
- 不要 live-apply。不要改 `.github/workflows/`。
- 不要在 agent 分支把套件改成 `blocked`。
- 不要发明 `python -m forge brief|credential|ops-chain|revoke`。
- 不要打 `ilovelearningguide.com`。不要改 Verify。

## Examples

```text
PYTHONPATH=/tmp/AIOps python3 -m forge check --root . --title "feat: adopt Overlay 2.0.0 and Forge 1.1.3 with dev/main"
```

非法：`required_checks: [Verify]`。非法：live `forge apply`。非法：pin `main`。

## Performance Notes

`check` 是本地的。token 细节只在工具仓 `docs/submit-credential.md`。现状页 [`docs/STATE.md`](../../../STATE.md) 是生成的。

## Troubleshooting

| 现象 | 处理 |
|---|---|
| 想把 `forge/` 拷进本仓 | 停。工具留在 `/tmp/AIOps`。 |
| checkout 已发布针失败 | `git fetch --tags` 后再 pin `overlay-v2.0.0` / `forge-v1.1.3`。不要 pin `main`。 |
| `required_checks` 写成 Verify | 改成 Typecheck / Lint / Build and test / overlay-check / forge-check。 |
| 想 live apply | 停。Oliver / `$manage-repo`。agent 不做。 |
| 想把套件标 blocked | 停。人写。`$manage-repo`。 |
| `docs_sync` 红了 | 修相对链接；改 suites/inbox/配置时同步改 [`overlay-forge-brief.md`](../../overlay-forge-brief.md)。 |
| 想把 workflow 写进功能 PR | 停。内容包按层配对是补设计（OF-23，待接受）。升针是 Ops 包。未接受前不加新锁。 |
| 缺 `FORGE_SUBMIT_TOKEN` | 停。不要粘贴 token。用 host PR，或等 Oliver 配环境密钥。 |
