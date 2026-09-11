#!/usr/bin/env python3
"""Run suite product_command when the named test files exist on this checkout.

This is the product workflow runner, not Overlay-armed select.
Do not vendor overlay/. Missing test files are skipped, not faked green.
Zero runs is idle and must fail.
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
    skipped: list[str] = []

    docs = suite_docs(root)
    if not docs:
        print("overlay-run-existing: no suites/*/suite.yaml", file=sys.stderr)
        return 1

    for path, doc in docs:
        suite_id = str(doc.get("id") or path.parent.name)
        command = str(doc.get("product_command") or "").strip()
        if not command:
            skipped.append(f"{suite_id}:no_command")
            print(f"skip {suite_id}: no product_command", file=sys.stderr)
            continue

        named = test_paths(command)
        if not named:
            skipped.append(f"{suite_id}:no_test_paths")
            print(f"skip {suite_id}: product_command has no test paths", file=sys.stderr)
            continue

        missing = [item for item in named if not (root / item).exists()]
        if missing:
            skipped.append(f"{suite_id}:missing:{','.join(missing)}")
            print(
                f"skip {suite_id}: test files not on this checkout: {', '.join(missing)}",
                file=sys.stderr,
            )
            continue

        print(f"run {suite_id}: {command}", flush=True)
        result = subprocess.run(["/bin/bash", "-c", command], cwd=root, check=False)
        ran += 1
        if result.returncode != 0:
            failed.append(f"{suite_id}:{result.returncode}")
            print(f"fail {suite_id}: exit={result.returncode}", file=sys.stderr)
        else:
            print(f"pass {suite_id}", flush=True)

    print(
        f"overlay-run-existing: ran={ran} failed={len(failed)} skipped={len(skipped)}",
        flush=True,
    )
    if skipped:
        print("skipped: " + "; ".join(skipped), file=sys.stderr)
    if ran < 1:
        print(
            "overlay-check is idle: no suite product_command ran. "
            "Green must not mean I/O passed.",
            file=sys.stderr,
        )
        return 1
    if failed:
        print("failed: " + "; ".join(failed), file=sys.stderr)
        return 1
    print(f"overlay-check executed {ran} suite product_command(s) from this checkout.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
