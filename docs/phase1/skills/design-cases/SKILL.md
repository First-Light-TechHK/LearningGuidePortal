---
name: design-cases
description: >-
  设计 Learning Guide Overlay 用例：叶子三技法 Functional / Negative / Edge
  加上已声明 invariant。写 cases.md 或 invariants.yaml 或跑 overlay cover 时用。
  不是行覆盖。配合 use-overlay。不要写 ### Depth 或 ## Specified。
metadata:
  short-description: Overlay 三技法、invariant、唯一 function_id
---

# Design Cases（Learning Guide）

写任何 `cases.md` 之前先定义 Overlay「满覆盖」。操作 Overlay 用 [`use-overlay`](../use-overlay/SKILL.md)。权威方法见工具仓 [design-cases](https://github.com/LibertychaserUS/AIOps/blob/overlay-v2.0.0/skills/design-cases/SKILL.md)。产品叶子与锁状态：[`overlay-forge-brief.md`](../../overlay-forge-brief.md) §7–§8。

## Instructions

满覆盖是三层——不是扫 PRD、不是行覆盖、不是 N×N 叶子：

| Layer | 标准 |
|---|---|
| Leaf techniques | 每个 `function_id` 有 Functional / Negative / Edge |
| Invariants | 每个已声明 invariant 在某篇 `cases.md` 被点名 |
| Interaction | 仅当叶子已经耦合（`span: interaction` + `relates`） |

写 `cases.md` 之前先读整个 overlay root：全部 `inbox/*.md`、全部 `suites/*/cases.md`、`invariants.yaml`，以及 Phase 1 文档里的「不得 / 永不」。

`active` 缺技法 → `validate` / `cover` 契约红。`blocked` 可以薄，cover 只提示。

### 1. Inventory

列出已有 `function_id`（AUTH-01..06、PAY-01..10、portal / my-learning）。照抄。不要发明 `E2E-B1` / `CROSS-01` / `REQ-n`。

### 2. Leaf triad

每个 `function_id` 是一个 `## <id>` 段。三个 `###` 标题必须是这些词（大小写不敏感）：

```markdown
## AUTH-01
### Functional
### Negative
### Edge
```

不要写 `### Depth`。不要写 `## Specified / not tested now`。`function_id` 全局唯一。`invariants.yaml` 的 `function_ids` 必须对上已有 `##` 标题。

### 3. Invariants

本仓已有 `INV-unauth-no-grant`、`INV-browser-not-price`、`INV-one-charge`。每个必须作为 token 出现在某篇 `cases.md`。不要把 invariant 指到不存在的 `##` 标题。

### 4. 只在耦合时写 interaction

共享 session / entitlement / 「不得同时」→ 写在先失败的那片叶子上，加上 `span: interaction` 与 `relates`。不要两两爆炸。

### 5. 人审

`cover` 打印矩阵。人决定 `blocked` / `active`。模型不要把别人的套件改成 `blocked`。人审证据在 PR 审批 + CODEOWNERS。

## Never

- 不要改 Verify。不要把 `test:io` 加进 `test:ci`。
- 不要打 `ilovelearningguide.com`。
- 不要在 push 上 generate。不要把套件改成 `blocked`。
- 不要 vendor `forge/` / `overlay/`。

## Examples

```text
PYTHONPATH=/tmp/AIOps python3 -m overlay cover --root .
```

半锁的 PAY 叶子留在 cases 里给人看；不要假装 HTTP 已经锁死 Stripe 内部。

## Performance Notes

`cover` / `validate` 只扫本仓 YAML 和 Markdown。

## Troubleshooting

| 现象 | 处理 |
|---|---|
| active 缺 Edge | 补 `### Edge`，不要用 `### Depth`，不要改成 blocked 躲。 |
| 写了 `## Specified` | 改成段落。 |
| 跨套件重复 function_id | 换一个稳定唯一的 id。 |
| invariant 点了不存在的 `##` | 先对齐标题。 |
| 想两两组合所有叶子 | 停。没有耦合就不是测试项。 |
