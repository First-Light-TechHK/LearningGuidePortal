---
name: use-overlay
description: >-
  在 Learning Guide 上操作 Overlay：inbox、suites、validate、cover、select、run。
  Pin overlay-v2.0.0。叶子必须是 ### Functional / ### Negative / ### Edge。
  状态只有 active|blocked。不要在 push 上 generate。不要改 overlay-check.yml 形状。
  Ruleset 用 use-forge。
metadata:
  short-description: Overlay v2 契约；active|blocked；不改 workflow
---

# Use Overlay（Learning Guide）

本仓薄操作说明。权威契约见工具仓 [use-overlay](https://github.com/LibertychaserUS/AIOps/blob/overlay-v2.0.0/skills/use-overlay/SKILL.md) 与 [overlay-contract.md](https://github.com/LibertychaserUS/AIOps/blob/overlay-v2.0.0/docs/overlay-contract.md)。

Overlay 把需求叶子变成可审套件。CI 只跑 **`active`**。`blocked` 丢掉，且不得把 `overlay-check` 染红。

本仓已有 `overlay.yaml`、`inbox/`、`suites/`、`invariants.yaml`、`.github/workflows/overlay-check.yml`。不要 vendor `overlay/`。Agent 不得把套件改成 `blocked`（`suite_guard`）。

Pin **`overlay-v2.0.0`**。不要 pin `main`。用例方法：[`design-cases`](../design-cases/SKILL.md)。入口：[`overlay-forge-brief.md`](../../overlay-forge-brief.md)。

## Contract (leaves)

`overlay validate` 把每个 `##` 标题的第一个无空白 token 当作 `function_id`。`active` 叶子必须有三个 `###` 技法标题：

```markdown
## AUTH-01
### Functional
### Negative
### Edge
```

- 技法标题必须是 **`### Functional` / `### Negative` / `### Edge`**。不要写 `### Depth`。
- 不要写 `## Specified`（或任何散文 `##`）。它会变成 `function_id`。
- `function_id` 在 overlay root **全局唯一**。
- `invariants.yaml` 的 `function_ids` 必须对上已有 `##` 标题。invariant id 必须作为 token 出现在某篇 `cases.md`。
- 新套件缺省 `active`。未就绪写成 `blocked`，且 `blocked_reason` 含 `http(s)://…` 或登记编号（`OF-12`、`#123`）。
- 套件文件用 `schema: overlay-suite/v2`。

## Instructions

1. Checkout 针：`git clone https://github.com/LibertychaserUS/AIOps.git /tmp/AIOps && git -C /tmp/AIOps checkout overlay-v2.0.0`
2. `python3 -m pip install -r /tmp/AIOps/requirements.txt` 并 `export PYTHONPATH=/tmp/AIOps`
3. 写或改 `inbox/<id>.md` 与 `suites/<id>/`。一片叶子一个 id。沿用 AUTH- / PAY- / portal / my-learning，不要另开一套编号。
4. 对着**整个** overlay root 设计用例（`$design-cases`）。
5. 校验：

```text
PYTHONPATH=/tmp/AIOps python3 -m overlay validate --root .
PYTHONPATH=/tmp/AIOps python3 -m overlay cover --root .
PYTHONPATH=/tmp/AIOps python3 -m overlay select --root .
```

`--branch` 缺省：`GITHUB_BASE_REF` → `GITHUB_REF_NAME` → `main`。未知分支回落 `branches.default`。

6. `blocked` 必须带链接或登记编号。Agent 不要把别人的 `active` 改成 `blocked`（那是人审 / `$manage-repo`）。
7. **保持** 已有 `.github/workflows/overlay-check.yml` 形状：单 job `overlay-check`，checkout `AIOps@overlay-v2.0.0` 到 `_aiops`、`npm ci`、`overlay validate` + `cover` + `run`。不要换成另一种形状。不要 pin `main`。此文件在 `deny_paths`。

**历史：** 从 1.0.x 升上来时用 `python -m overlay migrate --root .`。现在不要再迁。

## Never

- 不要 vendor `overlay/` / `forge/`。
- 不要改 overlay-check / forge-check 形状。
- 不要改 Verify。不要把 `test:io` 加进 `test:ci`。
- 不要打 `ilovelearningguide.com`。
- 不要在 push 上 generate。不要把套件改成 `blocked`。
- 不要把 workshop 的 `pr-title` / `sop-lock` 抄进本仓 CI。

## Examples

```text
PYTHONPATH=/tmp/AIOps python3 -m overlay validate --root .
PYTHONPATH=/tmp/AIOps python3 -m overlay cover --root .
# select：blocked 丢掉；overlay-check 仍绿
```

## Performance Notes

validate / cover / select 是本地 YAML。无模型。`run` 只执行 `active` 的 `product_command`。`forbid_hosts` 只是字符串匹配，不是安全边界。

## Troubleshooting

| 现象 | 处理 |
|---|---|
| 想把 `overlay/` 拷进本仓 | 停。`PYTHONPATH=/tmp/AIOps`。 |
| `### Depth` / `## Specified` | 契约红。改成 `### Edge`；Specified 改成段落。 |
| 跨套件重复 `function_id` | 契约红。全局唯一。 |
| invariant 点了不存在的 `##` | 契约红。先对齐标题。 |
| 想把 overlay-check 改成另一种形状 | 停。已有 inline 单 job，不要换。 |
| 想 pin `main` | 停。pin `overlay-v2.0.0`。 |
| 想把套件改成 blocked | 停。人写 reason 链接。`$manage-repo`。 |
