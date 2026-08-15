#!/usr/bin/env python3
"""Print a reproducible SHA-256 manifest for the deterministic R6 design core.

The command is deliberately read-only.  It hashes the declarative model,
generators, frozen evidence inputs, generated text contracts, and the Draw.io
source.  Third-party visual exports and reviewer evidence are reported as
excluded because they can contain wall-clock metadata or are appended after the
design itself has been frozen.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

ROOT_ARTIFACTS = (
    "00-review-baseline.md",
    "01-current-database-audit.md",
    "02-target-database-blueprint.md",
    "03-table-and-field-dictionary.md",
    "04-current-to-target-matrix.md",
    "05-project-compatibility-matrix.md",
    "06-first-principles-decision-review.md",
    "08-r6-minimal-physical-foundation.md",
    "09-implementation-guardrails-and-security.md",
    "HOTCRUSH-Core-V1-R6-最小物理基座评审稿.html",
    "HOTCRUSH-Core-V1-方案C数据库评审稿.html",
    "README.md",
    "current-field-dictionary.csv",
    "current-field-to-target-matrix.csv",
    "current-guardrail-to-target-matrix.csv",
    "current-object-catalog.csv",
    "current-to-target-matrix.csv",
    "project-compatibility-matrix.csv",
    "r5-to-r6-disposition.csv",
    "target-comments-contract.sql",
    "target-field-dictionary.csv",
    "target-model.json",
    "target-storage-necessity-audit.csv",
    "target-table-catalog.csv",
    "target-table-implementation-guardrails.csv",
    "target-view-catalog.csv",
    "evidence/p0c-source-fidelity-and-reward-2026-08-10.md",
)

EVIDENCE_INPUTS = (
    "evidence/code-access-snapshot.json",
    "evidence/current-schema-snapshot.json",
    "evidence/pos-member-order-item-audit.json",
    "evidence/review-baseline.json",
)

TOOL_SOURCES = (
    "tools/drawio_autolayout_fallback.py",
    "tools/generate-drawio-blueprint.py",
    "tools/generate-review-artifacts.py",
    "tools/hash-review-package.py",
    "tools/scan-code-access.py",
    "tools/snapshot-current-database.mjs",
    "tools/validate-review-package.py",
)

DIAGRAM_SOURCES = (
    "diagrams/HOTCRUSH-Core-V1-R6-最小物理基座蓝图.drawio",
)

EXCLUDED_OUTPUTS = (
    "diagrams/*.png (raster export; validated separately for dimensions)",
    "diagrams/*.pdf (third-party exporter embeds wall-clock metadata)",
    "diagrams/*-网页交互版.html (third-party visual export)",
    "evidence/claude-*.md (independent reviewer inputs/outputs appended after design freeze)",
    "evidence/final-*.md (acceptance records appended after design freeze)",
)


def hashed_paths() -> tuple[Path, ...]:
    relative_paths = set(ROOT_ARTIFACTS + EVIDENCE_INPUTS + TOOL_SOURCES + DIAGRAM_SOURCES)
    relative_paths.update(
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "model").glob("*.py")
        if path.is_file()
    )
    paths = tuple(ROOT / relative_path for relative_path in sorted(relative_paths))
    missing = [path.relative_to(ROOT).as_posix() for path in paths if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"deterministic hash scope is missing files: {missing}")
    return paths


def build_manifest() -> dict[str, object]:
    files = []
    aggregate = hashlib.sha256()
    for path in hashed_paths():
        relative_path = path.relative_to(ROOT).as_posix()
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        aggregate.update(relative_path.encode("utf-8"))
        aggregate.update(b"\0")
        aggregate.update(digest.encode("ascii"))
        aggregate.update(b"\n")
        files.append({
            "path": relative_path,
            "size_bytes": len(content),
            "sha256": digest,
        })
    return {
        "algorithm": "SHA-256",
        "aggregate_scheme": "sorted relative_path + NUL + file_sha256 + LF",
        "scope": "deterministic design core and frozen evidence inputs",
        "file_count": len(files),
        "aggregate_sha256": aggregate.hexdigest(),
        "files": files,
        "excluded_outputs": list(EXCLUDED_OUTPUTS),
        "limitations": [
            "Equality proves byte-for-byte repeatability only for the declared scope.",
            "It does not prove production schema freshness, migration safety, or semantic correctness.",
            "Visual exports remain subject to page-count, coverage, resolution, and manual readability checks.",
        ],
    }


def main() -> None:
    print(json.dumps(build_manifest(), ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
