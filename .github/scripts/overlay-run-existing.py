#!/usr/bin/env python3
"""Discover and run this repo's tests using Overlay function_id names.

Overlay v1.0.0 does not scan tests/. Recognition lives here:
cases.md `## <function_id>` (same parse as overlay/validate.py) maps to
tests/io/<suite-id>.test.ts or tests/unit/<function_id>-*.test.ts.

Do not skip. Do not mark blocked. Do not add tests/io or e2e to Verify.
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
    ran = 0
    failed: list[str] = []

    docs = suite_docs(root)
    if not docs:
        print("overlay-run-existing: no suites/*/suite.yaml", file=sys.stderr)
        return 1

    for path, doc in docs:
        suite_id = str(doc.get("id") or path.parent.name)
        command = str(doc.get("product_command") or "").strip()
        cases = path.parent / "cases.md"
        function_ids = cases_function_ids(cases.read_text(encoding="utf-8")) if cases.is_file() else []
        paths = discover_paths(root, path.parent, suite_id, command)
        rels = [item.relative_to(root).as_posix() for item in paths]
        print(
            f"discover {suite_id}: function_ids={','.join(function_ids) or '-'} files={','.join(rels) or '-'}",
            flush=True,
        )
        if discover_only:
            if not paths:
                failed.append(f"{suite_id}:none")
            continue
        if not paths:
            print(f"fail {suite_id}: no tests matched Overlay function_id names", file=sys.stderr)
            failed.append(f"{suite_id}:none")
            continue

        run_cmd = command_for(paths, serial=suite_id in {"login", "payment"})
        print(f"run {suite_id}: {run_cmd}", flush=True)
        result = subprocess.run(["/bin/bash", "-c", run_cmd], cwd=root, check=False)
        ran += 1
        if result.returncode != 0:
            failed.append(f"{suite_id}:{result.returncode}")
            print(f"fail {suite_id}: exit={result.returncode}", file=sys.stderr)
        else:
            print(f"pass {suite_id}", flush=True)

    if discover_only:
        if failed:
            print("discover failed: " + "; ".join(failed), file=sys.stderr)
            return 1
        print("overlay-run-existing: discover ok")
        return 0

    print(f"overlay-run-existing: ran={ran} failed={len(failed)}", flush=True)
    if ran < 1:
        print("overlay-check is idle: no suite tests ran.", file=sys.stderr)
        return 1
    if failed:
        print("failed: " + "; ".join(failed), file=sys.stderr)
        return 1
    print(f"overlay-check executed {ran} suite(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
