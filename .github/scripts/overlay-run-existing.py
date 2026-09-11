#!/usr/bin/env python3
"""Run every suite product_command. Do not skip. Do not mark blocked.

Missing files or a failing command fail the job. Zero runs is idle.
This is the product workflow runner, not Overlay-armed select.
"""

from __future__ import annotations

import shlex
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    print("overlay-run-existing: PyYAML is required", file=sys.stderr)
    raise SystemExit(2)


def suite_docs(root: Path) -> list[tuple[Path, dict]]:
    docs: list[tuple[Path, dict]] = []
    for path in sorted((root / "suites").glob("*/suite.yaml")):
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise SystemExit(f"overlay-run-existing: {path} is not a mapping")
        docs.append((path, loaded))
    return docs


def test_paths(command: str) -> list[str]:
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


def main() -> int:
    root = Path.cwd()
    ran = 0
    failed: list[str] = []

    docs = suite_docs(root)
    if not docs:
        print("overlay-run-existing: no suites/*/suite.yaml", file=sys.stderr)
        return 1

    for path, doc in docs:
        suite_id = str(doc.get("id") or path.parent.name)
        command = str(doc.get("product_command") or "").strip()
        if not command:
            print(f"fail {suite_id}: suite.yaml has no product_command", file=sys.stderr)
            failed.append(f"{suite_id}:no_command")
            continue

        named = test_paths(command)
        if not named:
            print(f"fail {suite_id}: product_command has no test paths", file=sys.stderr)
            failed.append(f"{suite_id}:no_test_paths")
            continue

        missing = [item for item in named if not (root / item).exists()]
        if missing:
            print(
                f"fail {suite_id}: test files missing: {', '.join(missing)}",
                file=sys.stderr,
            )
            failed.append(f"{suite_id}:missing")
            continue

        print(f"run {suite_id}: {command}", flush=True)
        result = subprocess.run(["/bin/bash", "-c", command], cwd=root, check=False)
        ran += 1
        if result.returncode != 0:
            failed.append(f"{suite_id}:{result.returncode}")
            print(f"fail {suite_id}: exit={result.returncode}", file=sys.stderr)
        else:
            print(f"pass {suite_id}", flush=True)

    print(f"overlay-run-existing: ran={ran} failed={len(failed)}", flush=True)
    if ran < 1:
        print(
            "overlay-check is idle: no suite product_command ran.",
            file=sys.stderr,
        )
        return 1
    if failed:
        print("failed: " + "; ".join(failed), file=sys.stderr)
        return 1
    print(f"overlay-check executed {ran} suite product_command(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
