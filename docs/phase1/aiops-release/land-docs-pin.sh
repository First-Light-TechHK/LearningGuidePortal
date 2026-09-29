#!/usr/bin/env bash
# Re-land AIOps 0007 (README tag links) + 0008 (deny_paths check). Already on main @ 075341a.
#
# One command, as a human with contents:write on AIOps (not cursor[bot]).
# How to grant write: APPLY.md §怎么给写权限 (Path A = this script --push; Path B = attach AIOps + Save + new agent).
#
#   bash docs/phase1/aiops-release/land-docs-pin.sh --push
#
# Same outcome from any directory (fetches this branch's 000*.patch files):
#
#   curl -fsSL https://raw.githubusercontent.com/LibertychaserUS/LearningGuidePortal/cursor/forge-agent-entry-2e0c/docs/phase1/aiops-release/land-docs-pin.sh | bash -s -- --push
#
# --push applies current AIOps main, pushes cursor/forge-docs-pin-2e0c, opens/reuses a draft PR.
# --probe-write: clone/fetch + dry-run push only (no am, no PR). Exit 0 = write:yes.
# Without --push: local apply only.
# Prefers the durable deploy key (~/.local/share/lg-secrets/aiops-deploy-ed25519 or
# $AIOPS_DEPLOY_SSH_KEY). Real SSH must ignore the HTTPS insteadOf rewrite.
# Never force-moves overlay-v1.0.0 / forge-v1.0.0 / 1.0.1. 0001-0006 are already on main.
#
# LAST_VERIFIED_MAIN is the AIOps main SHA these 000*.patch files last applied
# onto (read-only fetch). Update it when you regenerate patches.
set -euo pipefail

LG_REPO=${LG_REPO:-LibertychaserUS/LearningGuidePortal}
LG_REF=${LG_REF:-cursor/forge-agent-entry-2e0c}
AIOPS_REPO=${AIOPS_REPO:-LibertychaserUS/AIOps}
DEST=${AIOPS_DIR:-/tmp/AIOps-docs-pin}
BRANCH=cursor/forge-docs-pin-2e0c
REMOTE=${AIOPS_REMOTE:-https://github.com/${AIOPS_REPO}.git}
SSH_REMOTE=git@github.com:${AIOPS_REPO}.git
DEPLOY_KEY_DEFAULT=${HOME}/.local/share/lg-secrets/aiops-deploy-ed25519
TITLE='docs(docs/agent): link 1.0.1 to git tags and enforce deny_paths in check'
LAST_VERIFIED_MAIN=075341a87df6fa426be7891e293fc26278bfd8f7
PUSH=0
NO_PR=0
FROM_GITHUB=0
PROBE_WRITE=0

usage() {
  sed -n '2,19p' "$0"
  echo "Usage: $0 [--push] [--probe-write] [--no-pr] [--from-github] [--dir PATH]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) PUSH=1; shift ;;
    --probe-write) PROBE_WRITE=1; shift ;;
    --no-pr) NO_PR=1; shift ;;
    --from-github) FROM_GITHUB=1; shift ;;
    --dir) DEST=$2; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
done

github_login() {
  # Identity only. Never print tokens or remote URLs (they may embed PATs).
  local out
  if command -v gh >/dev/null 2>&1; then
    out=$(gh api user --jq '.login' 2>/dev/null || true)
    if [[ "$out" =~ ^[A-Za-z0-9_\[\]-]+$ ]]; then
      echo "$out"
      return 0
    fi
  fi
  return 0
}

deploy_key_file() {
  if [[ -n "${AIOPS_DEPLOY_KEY:-}" && -f "${AIOPS_DEPLOY_KEY}" ]]; then
    echo "$AIOPS_DEPLOY_KEY"
    return 0
  fi
  if [[ -f "$DEPLOY_KEY_DEFAULT" ]]; then
    echo "$DEPLOY_KEY_DEFAULT"
    return 0
  fi
  if [[ -f "${HOME}/.local/share/lg-secrets/cursor-cloud-aiops-deploy-448c" ]]; then
    echo "${HOME}/.local/share/lg-secrets/cursor-cloud-aiops-deploy-448c"
    return 0
  fi
  if [[ -n "${AIOPS_DEPLOY_SSH_KEY:-}" ]]; then
    local tmp
    tmp=$(mktemp)
    printf '%s\n' "$AIOPS_DEPLOY_SSH_KEY" >"$tmp"
    chmod 600 "$tmp"
    echo "$tmp"
    return 0
  fi
  return 1
}

# Real SSH. Global url.*.insteadOf rewrites git@github.com to cursor[bot] HTTPS.
with_deploy_ssh() {
  local key=$1
  shift
  env GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
    GIT_SSH_COMMAND="ssh -i ${key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
    "$@"
}

probe_write() {
  local err login denied key
  err=$(mktemp)
  if key=$(deploy_key_file); then
    if with_deploy_ssh "$key" git -C "$DEST" push --dry-run "$SSH_REMOTE" "origin/main:refs/heads/$BRANCH" 2>"$err"; then
      echo "write:yes on $AIOPS_REPO via deploy-key SSH (dry-run push of $BRANCH)"
      rm -f "$err"
      return 0
    fi
  fi
  if git -C "$DEST" push --dry-run origin "origin/main:refs/heads/$BRANCH" 2>"$err"; then
    echo "write:yes on $AIOPS_REPO (HTTPS dry-run push of $BRANCH)"
    rm -f "$err"
    return 0
  fi
  denied=$(sed -n 's/.*denied to \([^[:space:].]*\).*/\1/p' "$err" | head -1)
  login=${denied:-$(github_login)}
  echo "write:no on $AIOPS_REPO as ${login:-unknown}." >&2
  echo "Need the durable deploy key (APPLY.md) or LibertychaserUS contents:write. cursor[bot] HTTPS cannot push AIOps." >&2
  grep -E 'Permission|denied|403|fatal' "$err" | sed 's#https://[^@]*@#https://#' >&2 || true
  rm -f "$err"
  return 1
}

sanity_docs_pin() {
  local readme="$DEST/README.md"
  local skill="$DEST/skills/manage-repo/SKILL.md"
  if [[ ! -f "$readme" ]]; then
    echo "sanity: missing $readme" >&2
    return 1
  fi
  if ! grep -q 'LibertychaserUS/AIOps' "$readme"; then
    echo "sanity: README is not the AIOps workshop README; skipping pin checks"
    return 0
  fi
  if ! grep -q 'tree/overlay-v1.0.1' "$readme"; then
    echo "sanity: README does not pin overlay-v1.0.1 via /tree/" >&2
    return 1
  fi
  if grep -nE '\]\(https://github.com/LibertychaserUS/AIOps/releases/tag/(overlay|forge)-v1\.0\.1\)' "$readme" "$DEST/README.zh-CN.md" 2>/dev/null; then
    echo "sanity: README still links missing 1.0.1 Release pages" >&2
    return 1
  fi
  if grep -nE 'gh skill install.*--agent copilot' "$readme" "$DEST/README.zh-CN.md" 2>/dev/null; then
    echo "sanity: README still installs with invalid --agent copilot" >&2
    return 1
  fi
  if [[ -f "$skill" ]] && command -v python3 >/dev/null 2>&1; then
    if ! python3 - "$skill" <<'PY'
import pathlib, sys
try:
    import yaml
except ImportError:
    sys.exit(0)
text = pathlib.Path(sys.argv[1]).read_text()
parts = text.split("---", 2)
if len(parts) < 3:
    print("sanity: manage-repo missing frontmatter", file=sys.stderr)
    sys.exit(1)
data = yaml.safe_load(parts[1])
if not isinstance(data, dict) or data.get("name") != "manage-repo":
    print("sanity: manage-repo frontmatter is not a mapping (unquoted Ops only: ?)", file=sys.stderr)
    sys.exit(1)
print("sanity: manage-repo frontmatter parses")
PY
    then
      echo "sanity: manage-repo YAML failed (this is why overlay-v1.0.0 cannot gh skill install --all)" >&2
      return 1
    fi
  fi
  echo "sanity: docs-pin README + manage-repo frontmatter ok"
}

pr_body() {
  cat <<'EOF'
## 做了什么

- Link 1.0.1 pins to `/tree/overlay-v1.0.1` (annotated tags exist; GitHub Release pages may 404).
- `forge check` now fails when the local diff touches `deny_paths`. Tests in `tests/forge/test_check.py`.
- Record `agent_branch_prefixes` on agent branches; first-cut still allows human prefixes.
- Say honestly that 1.0.1 publishing is Human/Ops and Release objects may still be missing.

## 为什么

Tags were treated as “published”. `deny_paths` was parsed and then ignored, so `forge check` stayed green on a workflow edit.

## 动了哪些门

- 通用 `pr-title` / `sop-lock`（永远跑）.
- `forge check` gains a `deny_paths` step. Official pin stays `overlay-v1.0.1` until Ops lands this and publishes a **new** semver.
- No Overlay / Verify rewrite. No live `forge apply`. No tag move.

## 怎么验

```text
git checkout overlay-v1.0.1
python3 -m pip install -r requirements.txt
export PYTHONPATH=$PWD
python3 -m unittest tests.forge.test_check tests.forge.test_status -q
python3 -m forge check --root . --title "docs(docs/agent): link 1.0.1 to git tags and enforce deny_paths in check"
```

## 不做什么

- Never force-move `1.0.0` or `1.0.1`. Never pin `main` for the Python checkout.
- Do not vendor `forge/` / `overlay/` into a product repo.
- Do not live-apply Rulesets or let an agent write `reviewed_by` / `armed`.

## 分工

- 审：Oliver Zhang (LibertychaserUS)
- 合：Oliver Zhang after `pr-title` / `sop-lock` are green. Squash, then 换底. Ops owns the next Release / semver.
EOF
}

resolve_patch_dir() {
  if [[ -n "${LG_PATCH_DIR:-}" ]]; then
    PATCH_DIR=$LG_PATCH_DIR
    echo "using patches in $PATCH_DIR"
    return
  fi
  local src=${BASH_SOURCE[0]:-$0}
  local dir=""
  if [[ "$FROM_GITHUB" -eq 0 && -f "$src" ]]; then
    dir=$(cd "$(dirname "$src")" 2>/dev/null && pwd || true)
  fi
  if [[ -n "${dir:-}" ]]; then
    shopt -s nullglob
    local local_patches=("$dir"/000*.patch)
    if [[ ${#local_patches[@]} -gt 0 ]]; then
      PATCH_DIR=$dir
      echo "using local patches in $PATCH_DIR"
      return
    fi
  fi

  local tmp
  tmp=$(mktemp -d)
  echo "fetching patches from https://github.com/${LG_REPO}/tree/${LG_REF}/docs/phase1/aiops-release"
  git clone --depth 1 --branch "$LG_REF" "https://github.com/${LG_REPO}.git" "$tmp/lg"
  PATCH_DIR="$tmp/lg/docs/phase1/aiops-release"
  shopt -s nullglob
  local remote_patches=("$PATCH_DIR"/000*.patch)
  if [[ ${#remote_patches[@]} -eq 0 ]]; then
    echo "no 000*.patch on ${LG_REPO}@${LG_REF}" >&2
    exit 2
  fi
}

open_or_reuse_pr() {
  if ! command -v gh >/dev/null 2>&1; then
    echo "gh not found; push succeeded. Open the draft PR as yourself:" >&2
    echo "  gh pr create --repo $AIOPS_REPO --base main --head $BRANCH --draft --title $(printf %q "$TITLE")"
    return 1
  fi
  local existing
  existing=$(gh pr list --repo "$AIOPS_REPO" --head "${AIOPS_REPO%%/*}:$BRANCH" --state open --json url --jq '.[0].url // empty' || true)
  if [[ -n "${existing:-}" ]]; then
    echo "draft PR already open: $existing"
    return 0
  fi
  local body_file
  body_file=$(mktemp)
  pr_body >"$body_file"
  gh pr create --repo "$AIOPS_REPO" --base main --head "$BRANCH" --draft \
    --title "$TITLE" --body-file "$body_file"
}

patch_subject() {
  # Unfolded Subject: of a format-patch file (mailinfo strips the [PATCH n/m] prefix).
  git mailinfo /dev/null /dev/null <"$1" | sed -n 's/^Subject: //p' | head -1
}

select_unapplied_patches() {
  # Keep only patches whose subject is not already a commit on origin/main.
  # Re-running after a landing must be a no-op, not a git am conflict.
  local applied
  applied=$(git -C "$DEST" log origin/main --format=%s)
  UNAPPLIED=()
  SKIPPED=0
  local patch subject
  for patch in "${ALL_PATCHES[@]}"; do
    subject=$(patch_subject "$patch")
    if [[ -n "$subject" ]] && grep -qxF -- "$subject" <<<"$applied"; then
      echo "skip $(basename "$patch") (already on origin/main)"
      SKIPPED=$((SKIPPED + 1))
    else
      UNAPPLIED+=("$patch")
    fi
  done
}

resolve_patch_dir
shopt -s nullglob
ALL_PATCHES=("$PATCH_DIR"/000*.patch "$PATCH_DIR"/00[1-9][0-9]*.patch)
if [[ ${#ALL_PATCHES[@]} -eq 0 ]]; then
  echo "no 000*.patch in $PATCH_DIR" >&2
  exit 2
fi

if [[ ! -d "$DEST/.git" ]]; then
  git clone "$REMOTE" "$DEST"
fi
git -C "$DEST" fetch origin main
MAIN_SHA=$(git -C "$DEST" rev-parse origin/main)
if [[ "$MAIN_SHA" != "$LAST_VERIFIED_MAIN" ]]; then
  echo "warning: origin/main is $MAIN_SHA; 000*.patch last verified on $LAST_VERIFIED_MAIN. Trying git am anyway." >&2
else
  echo "origin/main $MAIN_SHA matches last-verified patches"
fi

select_unapplied_patches
if [[ ${#UNAPPLIED[@]} -eq 0 ]]; then
  echo "skipped $SKIPPED already on origin/main; nothing to apply (origin/main $MAIN_SHA)"
  git -C "$DEST" checkout -q --force --no-track -B "$BRANCH" origin/main
  exit 0
fi
PATCHES=("${UNAPPLIED[@]}")
echo "skipped $SKIPPED already on origin/main; ${#PATCHES[@]} to apply"

if [[ "$PUSH" -eq 1 || "$PROBE_WRITE" -eq 1 ]]; then
  if ! probe_write; then
    echo "Cloud Agents cannot land this. How to grant write: docs/phase1/aiops-release/APPLY.md §怎么给写权限" >&2
    echo "Path A (own gh, no token sharing): $0 --push" >&2
    exit 1
  fi
fi
if [[ "$PROBE_WRITE" -eq 1 && "$PUSH" -eq 0 ]]; then
  echo "probe-write only; not applying patches. Run without --probe-write to am, or add --push to land."
  exit 0
fi

git -C "$DEST" am --abort 2>/dev/null || true
git -C "$DEST" checkout --force --no-track -B "$BRANCH" origin/main
git -C "$DEST" clean -fd
if ! git -C "$DEST" am "${PATCHES[@]}"; then
  echo "git am failed on origin/main $MAIN_SHA. Refresh 000*.patch from a clean apply of current main, then retry." >&2
  echo "Do not force-move overlay-v1.0.0 / forge-v1.0.0. Do not publish 1.0.1." >&2
  exit 2
fi
echo "applied ${#PATCHES[@]} patch(es) on origin/main $MAIN_SHA"
sanity_docs_pin

# Local forge checks must not block --push. Oliver may have git+gh only.
if command -v python3 >/dev/null 2>&1; then
  if ! PYTHONPATH="$DEST" python3 -m forge sop-lock --root "$DEST"; then
    echo "warning: local sop-lock failed; continuing (CI will re-check)" >&2
  fi
  if ! PYTHONPATH="$DEST" python3 -m forge pr-title --title "$TITLE"; then
    echo "warning: local pr-title failed; continuing (CI will re-check)" >&2
  fi
fi

echo "landed $BRANCH at $(git -C "$DEST" rev-parse HEAD)"
echo "base origin/main $(git -C "$DEST" rev-parse origin/main)"

if [[ "$PUSH" -eq 0 ]]; then
  echo "Next (needs contents:write on $AIOPS_REPO, as you — not cursor[bot]):"
  echo "  $0 --push --dir $DEST"
  exit 0
fi

PUSH_OK=0
if key=$(deploy_key_file); then
  if with_deploy_ssh "$key" git -C "$DEST" push -u "$SSH_REMOTE" "$BRANCH"; then
    PUSH_OK=1
    echo "pushed $SSH_REMOTE $BRANCH via deploy-key SSH"
  fi
fi
if [[ "$PUSH_OK" -eq 0 ]]; then
  if git -C "$DEST" push -u origin "$BRANCH"; then
    PUSH_OK=1
    echo "pushed origin/$BRANCH"
  fi
fi
if [[ "$PUSH_OK" -eq 0 ]]; then
  login=$(github_login)
  echo "push failed as ${login:-unknown}. Add the durable deploy key in APPLY.md, or run as LibertychaserUS with contents:write (not cursor[bot])." >&2
  exit 1
fi

if [[ "$NO_PR" -eq 1 ]]; then
  echo "skipped PR (--no-pr). Open when ready:"
  echo "  gh pr create --repo $AIOPS_REPO --base main --head $BRANCH --draft --title $(printf %q "$TITLE")"
  exit 0
fi

open_or_reuse_pr
echo "Do not force-move overlay-v1.0.0 / forge-v1.0.0 / 1.0.1. Ops owns the next Release / semver."
