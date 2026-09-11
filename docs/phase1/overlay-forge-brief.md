# Learning Guide × Overlay / Forge

**workflow 门禁 ≠ Overlay armed：** `.github/scripts/overlay-run-existing.py` 是 overlay-check 的 workflow gate，不是 Overlay `select` 的 armed 选择。脚本读 `overlay.yaml` 的 `never_red_statuses`（默认 `draft`, `blocked`），并仍发现/跑 login、payment。在这两套绿之前，只有已经绿的 `my-learning`、`portal` 硬红；login/payment 失败记 observe，不让 job 红。不要写 `reviewed_by`，不要把 `status` 写成 `armed`。
