# Apply the AIOps docs/skills pin

## 现在请抄这一块（官方针）

**官方针（现在）：** `overlay-v2.0.0`（Overlay）与 `forge-v1.1.3`（Forge）。同一工具仓、两件产品，不要手抄 SHA；现状看产品仓 [`docs/STATE.md`](../../STATE.md)。不要只用 Overlay 针当 Forge。

```text
git clone https://github.com/LibertychaserUS/AIOps.git /tmp/AIOps
git -C /tmp/AIOps checkout overlay-v2.0.0
# Forge CLI 用已发布针：git -C /tmp/AIOps checkout forge-v1.1.3
python3 -m pip install -r /tmp/AIOps/requirements.txt
export PYTHONPATH=/tmp/AIOps
# pip 不会装出 forge 命令；必须 PYTHONPATH + python3 -m overlay / python3 -m forge
```

本目录的 lander（`000*.patch`、`land-docs-pin.sh`）是 **历史**：当时 agent 推不了 AIOps。新的 AIOps 改动走 `dev` → `forge promote` → `main`。已发布 tag 的 GitHub Release 页已补齐；新 semver 仍走 `forge release`。不要拿 Latest 当针（可能仍是 `forge-v1.0.0`）。`overlay-v2.0.0` peel 不含 Forge 1.1.3，必须第二针。

**不要抄下面历史块。** 针脚与「Humans arm」叙述已过期。第一条可复制命令是上面的 `overlay-v2.0.0`，不是 `checkout overlay-v1.0.1`。

---

## 2026-09-11 Overlay 2.0.0 / Forge 1.1.2（lander 当时的记录）

**历史针：** `overlay-v1.0.1` / `forge-v1.0.1` @ `b4afc10ae0be4725e5109030f14a05bb2291fe4a`。

`1.0.1` is an **annotated git tag**, not a GitHub Release page. `gh release view overlay-v1.0.1` is 404. Pin [`/tree/overlay-v1.0.1`](https://github.com/LibertychaserUS/AIOps/tree/overlay-v1.0.1). Do not link `/releases/tag/overlay-v1.0.1`. Do not pin `main`. Do not force-move `1.0.0` (`235e514e673fa68b24879c8e139f2a5c6633ebb5`) or `1.0.1`. Next Release / semver is Human/Ops (`forge release` or Actions `release`).

`0001`–`0008` are on AIOps `main` @ **`075341a87df6fa426be7891e293fc26278bfd8f7`** (2026-09-11, FF over the durable deploy key). Official **pin stays** `overlay-v1.0.1` @ `b4afc10` — do not pin `main`, do not retag `1.0.1`. This directory lives on Learning Guide branch `cursor/forge-agent-entry-2e0c`, not on Overlay quality-gate PR #5.

```text
git clone https://github.com/LibertychaserUS/AIOps.git /tmp/AIOps
git -C /tmp/AIOps checkout overlay-v1.0.1
python3 -m pip install -r /tmp/AIOps/requirements.txt
export PYTHONPATH=/tmp/AIOps
gh skill install LibertychaserUS/AIOps --agent cursor --pin overlay-v1.0.1 --all
```

`gh skill` host ids: `codex` / `cursor` / `claude-code` / `github-copilot`.

---

## Landed: 0007 + 0008

Already fast-forwarded to AIOps `main` (`075341a`). README 1.0.1 links are `/tree/overlay-v1.0.1`. `forge check` on `main` fails when the diff touches `deny_paths`. The published pin `overlay-v1.0.1` does **not** include `0008` until Ops cuts a new semver.

Re-apply / re-push if `main` moves (never force-move tags):

```text
bash docs/phase1/aiops-release/land-docs-pin.sh --push --no-pr
```

---

## Durable deploy key (not one-shot)

`cursor-cloud-aiops-deploy-448c` is the durable write key. It authenticated `Hi LibertychaserUS/AIOps!` and FF’d `main` to `075341a`. Reuse this pair. Do **not** generate another.

- Public:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJTwhA9JEwDxc7lhNk0zk490uAJ57G3qv2AfcIWepTPf cursor-cloud-aiops-deploy-448c
```

Still persist the private key as environment secret `AIOPS_DEPLOY_SSH_KEY` so the next Cloud Agent pod does not lose it: [bba32537-ad04-11f1-bf4b-42ffb4d10ea7](https://cursor.com/dashboard/cloud-agents/environments/e/bba32537-ad04-11f1-bf4b-42ffb4d10ea7). On this VM: `~/.local/share/lg-secrets/aiops-deploy-ed25519`. `land-docs-pin.sh` uses that file or `$AIOPS_DEPLOY_SSH_KEY` over real SSH (it disables the HTTPS `insteadOf` rewrite that turns `git@` into `cursor[bot]`).

不要粘贴 PAT。不要用 First-Light PAT。

**Path B (App write):** [Environment](https://cursor.com/dashboard/cloud-agents/environments/e/bba32537-ad04-11f1-bf4b-42ffb4d10ea7) → attach `LibertychaserUS/AIOps` with `contents:write` → Save → **new** Cloud Agent. Save does not upgrade this run.

---

## Honesty that stays

- **Humans arm.** Agents must not write `reviewed_by` / `armed`. login / payment / portal / my-learning on fork `main` came through Oliver’s squash of PR #4 (`134ce2ae`). First fill of `reviewed_by: LibertychaserUS` was a Cursor Agent commit (`c3aee96e`); do not un-arm without Oliver. New suites stay draft.
- **Rulesets are a declaration.** `forge.yaml` is local. `gh api …/rulesets` is `[]` on LibertychaserUS / First-Light LearningGuidePortal and on AIOps. Phase 1 Ops does not live-apply to this product.
- **`deny_paths` is enforced on AIOps `main` (`075341a`), not on the published 1.0.1 pin.** Checkout `overlay-v1.0.1` still exits 0 if a PR touches `.github/workflows/overlay-check.yml`. Do not pin floating `main`. Ops publishes a **new** semver when product repos should pick up `0008`.

---

## After landing (already on `main`)

```text
python3 -m forge sop-lock --root .
python3 -m unittest tests.forge.test_check tests.forge.test_status -q
```

Next semver (never force-move an existing tag):

```text
python3 -m forge release --repo LibertychaserUS/AIOps --version X.Y.Z --dry-run
python3 -m forge release --repo LibertychaserUS/AIOps --version X.Y.Z
```

`cursor[bot]` cannot POST GitHub Releases (403). Deploy-key SSH can push annotated tags. Ops should create Release pages for the existing `1.0.1` tags, or own the next semver.
