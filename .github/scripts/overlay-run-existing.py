#!/usr/bin/env python3
"""Discover and run this repo's tests using Overlay function_id names.

This script is the overlay-check *workflow gate*, not Overlay `select` armed.
Overlay v1.0.0 does not scan tests/. Recognition lives here:
cases.md `## <function_id>` (same parse as overlay/validate.py) maps to
tests/io/<suite-id>.test.ts or tests/unit/<function_id>-*.test.ts.

Hard-red is only WORKFLOW_GATE_SUITES (my-learning, portal) until login/payment
are green. login/payment still discover/run as observe; their failure does not
fail the job. Do not skip. Do not mark blocked. Do not write reviewed_by or
status: armed. Do not add tests/io or e2e to Verify.
"""

from __future__ import annotations

import re
import shlex
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    print("overlay-run-existing: PyYAML is required", file=sys.stderr)
    raise SystemExit(2)

FUNCTION_ID_RE = re.compile(r"^\S+$")
H2_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
NODE_TEST = (
    "node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test"
)
SKIP_STEMS = frozenset({"harness"})
SKIP_SUFFIXES = (".skip.spec.ts", ".skip.test.ts")
DEFAULT_NEVER_RED = ("draft", "blocked")
# Workflow hard-red only. Not Overlay select / armed.
WORKFLOW_GATE_SUITES = frozenset({"my-learning", "portal"})


# Same as overlay/validate.py parse_function_id / cases_function_ids.
def parse_function_id(heading: str) -> str | None:
    parts = heading.split()
    if not parts:
        return None
    token = parts[0]
    if FUNCTION_ID_RE.fullmatch(token) is None:
        return None
    return token


def cases_function_ids(cases_text: str) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for match in H2_RE.finditer(cases_text):
        token = parse_function_id(match.group(1))
        if token is None or token in seen:
            continue
        ids.append(token)
        seen.add(token)
    return ids


def overlay_config(root: Path) -> dict:
    path = root / "overlay.yaml"
    if not path.is_file():
        return {}
    loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    return loaded if isinstance(loaded, dict) else {}


def never_red_statuses(root: Path) -> list[str]:
    raw = overlay_config(root).get("never_red_statuses")
    if not isinstance(raw, list) or not raw:
        return list(DEFAULT_NEVER_RED)
    return [str(item) for item in raw]


def suite_docs(root: Path) -> list[tuple[Path, dict]]:
    docs: list[tuple[Path, dict]] = []
    for path in sorted((root / "suites").glob("*/suite.yaml")):
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise SystemExit(f"overlay-run-existing: {path} is not a mapping")
        docs.append((path, loaded))
    return docs


def declared_command_paths(command: str) -> list[str]:
    tokens = shlex.split(command)
    paths: list[str] = []
    take = False
    for token in tokens:
        if token == "--test":
            take = True
            continue
        if take and not token.startswith("-"):
            paths.append(token)
    return paths


def stem_matches_function_id(stem: str, function_id: str) -> bool:
    if stem == function_id or stem.startswith(f"{function_id}-"):
        return True
    family = re.sub(r"-\d+$", "", function_id)
    if family != function_id and (stem == family or stem.startswith(f"{family}-")):
        # Only the UC-PORTAL-1 → UC-PORTAL-* fallback. Do not widen ML-FR-004
        # to every ML-FR-* file (those belong to other leaves).
        if family.count("-") >= 1 and not family.endswith("-FR"):
            return True
    return False


def discover_paths(root: Path, suite_dir: Path, suite_id: str, command: str) -> list[Path]:
    cases = suite_dir / "cases.md"
    function_ids = cases_function_ids(cases.read_text(encoding="utf-8")) if cases.is_file() else []
    found: list[Path] = []
    seen: set[Path] = set()

    def add(path: Path) -> None:
        resolved = path.resolve()
        if resolved in seen or not path.is_file():
            return
        name = path.name
        if path.stem in SKIP_STEMS or name.endswith(SKIP_SUFFIXES):
            return
        if "helpers" in path.parts:
            return
        seen.add(resolved)
        found.append(path)

    io_dir = root / "tests" / "io"
    if io_dir.is_dir():
        add(io_dir / f"{suite_id}.test.ts")
        for path in sorted(io_dir.glob("*.test.ts")):
            if any(stem_matches_function_id(path.stem, fid) for fid in function_ids):
                add(path)

    unit_dir = root / "tests" / "unit"
    if unit_dir.is_dir():
        for path in sorted(unit_dir.glob("*.test.ts")):
            if any(stem_matches_function_id(path.stem, fid) for fid in function_ids):
                add(path)

    for raw in declared_command_paths(command):
        extra = root / raw
        if extra.is_file() and extra.suffix == ".ts" and "tests/e2e" not in extra.as_posix():
            add(extra)

    return found


def command_for(paths: list[Path], *, serial: bool) -> str:
    flags = " --test-concurrency=1" if serial else ""
    joined = " ".join(shlex.quote(path.as_posix()) for path in paths)
    return f"{NODE_TEST}{flags} {joined}"


def is_gate_suite(suite_id: str) -> bool:
    return suite_id in WORKFLOW_GATE_SUITES


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    discover_only = "--discover" in args
    root = Path.cwd()
    if "--root" in args:
        idx = args.index("--root")
        if idx + 1 >= len(args):
            print("overlay-run-existing: --root needs a directory", file=sys.stderr)
            return 2
        root = Path(args[idx + 1]).resolve()
        if not root.is_dir():
            print(f"overlay-run-existing: --root is not a directory: {root}", file=sys.stderr)
            return 2

    never_red = never_red_statuses(root)
    print(
        "overlay-run-existing: workflow gate (not Overlay select armed); "
        f"never_red_statuses={','.join(never_red)}; "
        f"gate={','.join(sorted(WORKFLOW_GATE_SUITES))}; "
        "observe=login,payment",
        flush=True,
    )

    docs = suite_docs(root)
    if not docs:
        print("overlay-run-existing: no suites/*/suite.yaml", file=sys.stderr)
        return 1

    gate_ran = 0
    observe_ran = 0
    gate_failed: list[str] = []
    observe_failed: list[str] = []

    for path, doc in docs:
        suite_id = str(doc.get("id") or path.parent.name)
        status = str(doc.get("status") or "draft")
        command = str(doc.get("product_command") or "").strip()
        cases = path.parent / "cases.md"
        function_ids = cases_function_ids(cases.read_text(encoding="utf-8")) if cases.is_file() else []
        paths = discover_paths(root, path.parent, suite_id, command)
        rels = [item.relative_to(root).as_posix() for item in paths]
        gate = is_gate_suite(suite_id)
        mode = "gate" if gate else "observe"
        print(
            f"discover {suite_id}: mode={mode} status={status} "
            f"function_ids={','.join(function_ids) or '-'} files={','.join(rels) or '-'}",
            flush=True,
        )
        if discover_only:
            if not paths and gate:
                gate_failed.append(f"{suite_id}:none")
            elif not paths:
                print(
                    f"observe {suite_id}: no tests matched Overlay function_id names "
                    "(not a workflow hard-red)",
                    flush=True,
                )
            continue
        if not paths:
            if gate:
                print(f"fail {suite_id}: no tests matched Overlay function_id names", file=sys.stderr)
                gate_failed.append(f"{suite_id}:none")
            else:
                print(
                    f"observe {suite_id}: no tests matched Overlay function_id names "
                    "(not a workflow hard-red)",
                    flush=True,
                )
            continue

        run_cmd = command_for(paths, serial=suite_id in {"login", "payment"})
        print(f"run {suite_id} ({mode}): {run_cmd}", flush=True)
        result = subprocess.run(["/bin/bash", "-c", run_cmd], cwd=root, check=False)
        if gate:
            gate_ran += 1
            if result.returncode != 0:
                gate_failed.append(f"{suite_id}:{result.returncode}")
                print(f"fail {suite_id}: exit={result.returncode}", file=sys.stderr)
            else:
                print(f"pass {suite_id}", flush=True)
        else:
            observe_ran += 1
            if result.returncode != 0:
                observe_failed.append(f"{suite_id}:{result.returncode}")
                print(
                    f"observe {suite_id}: exit={result.returncode} "
                    "(observe / not a workflow hard-red)",
                    flush=True,
                )
            else:
                print(f"pass {suite_id} (observe)", flush=True)

    if discover_only:
        if gate_failed:
            print("discover failed: " + "; ".join(gate_failed), file=sys.stderr)
            return 1
        print("overlay-run-existing: discover ok")
        return 0

    print(
        f"overlay-run-existing: gate_ran={gate_ran} gate_failed={len(gate_failed)} "
        f"observe_ran={observe_ran} observe_failed={len(observe_failed)}",
        flush=True,
    )
    if observe_failed:
        print(
            "observe failures (not a workflow hard-red): " + "; ".join(observe_failed),
            flush=True,
        )
    if gate_ran < 1:
        print("overlay-check is idle: no gate suite tests ran.", file=sys.stderr)
        return 1
    if gate_failed:
        print("failed: " + "; ".join(gate_failed), file=sys.stderr)
        return 1
    print(f"overlay-check executed {gate_ran} gate suite(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
