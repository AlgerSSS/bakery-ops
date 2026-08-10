#!/usr/bin/env python3
"""Build a metadata-only inventory of current database object references.

This is a conservative static scan, not proof of runtime execution.  It records
where each current table/view name appears and classifies obvious SQL reads and
writes.  Dynamic SQL and aliases remain marked as ambiguous for manual review.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import re


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SNAPSHOT = HERE.parent / "evidence" / "current-schema-snapshot.json"
OUTPUT = HERE.parent / "evidence" / "code-access-snapshot.json"

PROJECTS = {
    "bakery_ops": REPO / "bakery-ops",
    "res_api": REPO / "res_api",
    "hbti_web": REPO / "hbti-web",
    "finance_web": Path(
        "/Users/weiliangshao/Library/Mobile Documents/"
        "iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统"
    ),
}

TEXT_EXTENSIONS = {
    ".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".py", ".sql",
    ".json", ".md", ".sh", ".yaml", ".yml",
}
RUNTIME_EXTENSIONS = {".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".py", ".sh"}
CONFIG_OR_DATA_EXTENSIONS = {".json", ".yaml", ".yml"}
ARTIFACT_DIRS = {"output", "data", "fixtures", "fixture", "snapshots", "examples", ".omx"}
SKIP_DIRS = {
    ".git", ".next", ".vercel", "node_modules", "dist", "build", "coverage",
    "playwright-report", "test-results", "__pycache__", ".turbo",
}

WRITE_PATTERNS = (
    re.compile(r"\binsert\s+into\s+{name}\b", re.I),
    re.compile(r"\bupdate\s+{name}\b", re.I),
    re.compile(r"\bdelete\s+from\s+{name}\b", re.I),
    re.compile(r"\.from\(\s*['\"]{name}['\"]\s*\).{{0,160}}\.(?:insert|update|upsert|delete)\b", re.I | re.S),
)
READ_PATTERNS = (
    re.compile(r"\bfrom\s+{name}\b", re.I),
    re.compile(r"\bjoin\s+{name}\b", re.I),
    re.compile(r"\.from\(\s*['\"]{name}['\"]\s*\)", re.I),
)


def layer_for(path: Path) -> str:
    lowered = {part.lower() for part in path.parts}
    if "migrations" in lowered or path.suffix == ".sql":
        return "migration_or_sql"
    if "test" in lowered or "tests" in lowered or "__tests__" in lowered or path.name.endswith((".test.ts", ".spec.ts", ".test.js", ".spec.js")):
        return "test"
    if "docs" in lowered or path.suffix == ".md":
        return "documentation"
    if lowered & ARTIFACT_DIRS:
        return "generated_or_fixture"
    if path.suffix in CONFIG_OR_DATA_EXTENSIONS:
        return "config_or_data"
    if path.suffix in RUNTIME_EXTENSIONS:
        return "runtime_or_script"
    return "other_artifact"


def iter_files(root: Path):
    if not root.exists():
        return
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        try:
            if path.stat().st_size > 2_000_000:
                continue
        except OSError:
            continue
        yield path


def classify_context(object_name: str, context: str) -> set[str]:
    escaped = re.escape(object_name)
    kinds: set[str] = set()
    for pattern in WRITE_PATTERNS:
        if re.compile(pattern.pattern.format(name=escaped), pattern.flags).search(context):
            kinds.add("write")
    for pattern in READ_PATTERNS:
        if re.compile(pattern.pattern.format(name=escaped), pattern.flags).search(context):
            kinds.add("read")
    if not kinds:
        kinds.add("ambiguous")
    return kinds


def main() -> None:
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    object_names = sorted(
        (item["object_name"] for item in snapshot["objects"]),
        key=lambda value: (-len(value), value),
    )
    object_pattern = re.compile(
        r"(?<![A-Za-z0-9_])(" + "|".join(map(re.escape, object_names)) + r")(?![A-Za-z0-9_])",
        re.I,
    )

    references: list[dict] = []
    project_status = {}
    for project, root in PROJECTS.items():
        project_status[project] = {"root": str(root), "exists": root.exists()}
        if not root.exists():
            continue
        for path in iter_files(root):
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            lines = text.splitlines()
            seen: set[tuple[str, int, str]] = set()
            for match in object_pattern.finditer(text):
                object_name = match.group(1).lower()
                line_no = text.count("\n", 0, match.start()) + 1
                start = max(0, match.start() - 240)
                end = min(len(text), match.end() + 240)
                context = text[start:end]
                for access_kind in classify_context(object_name, context):
                    key = (object_name, line_no, access_kind)
                    if key in seen:
                        continue
                    seen.add(key)
                    display_line = lines[line_no - 1].strip()[:300] if line_no <= len(lines) else ""
                    references.append(
                        {
                            "project": project,
                            "project_root": str(root),
                            "file": str(path.relative_to(root)),
                            "line": line_no,
                            "layer": layer_for(path),
                            "object_name": object_name,
                            "access_kind": access_kind,
                            "line_text": display_line,
                        }
                    )

    by_object: dict[str, dict] = {}
    grouped = defaultdict(list)
    for item in references:
        grouped[item["object_name"]].append(item)
    for object_name in sorted(object_names):
        items = grouped[object_name]
        runtime_items = [item for item in items if item["layer"] == "runtime_or_script"]
        by_object[object_name] = {
            "runtime_projects": sorted({item["project"] for item in runtime_items}),
            "runtime_readers": sorted({item["project"] for item in runtime_items if item["access_kind"] == "read"}),
            "runtime_writers": sorted({item["project"] for item in runtime_items if item["access_kind"] == "write"}),
            "runtime_ambiguous": sorted({item["project"] for item in runtime_items if item["access_kind"] == "ambiguous"}),
            "reference_count": len(items),
            "runtime_reference_count": len(runtime_items),
        }

    payload = {
        "snapshot_version": 1,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Conservative static text scan. Read/write classifications are evidence leads, "
            "not proof of runtime execution; dynamic SQL requires manual verification."
        ),
        "projects": project_status,
        "summary": {
            "object_count": len(object_names),
            "reference_count": len(references),
            "runtime_reference_count": sum(1 for item in references if item["layer"] == "runtime_or_script"),
            "objects_with_runtime_references": sum(
                1 for item in by_object.values() if item["runtime_reference_count"]
            ),
            "layer_counts": dict(sorted(Counter(item["layer"] for item in references).items())),
        },
        "by_object": by_object,
        "references": sorted(
            references,
            key=lambda item: (item["project"], item["file"], item["line"], item["object_name"], item["access_kind"]),
        ),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"wrote {OUTPUT}: {payload['summary']['reference_count']} references across "
        f"{payload['summary']['objects_with_runtime_references']} runtime objects"
    )


if __name__ == "__main__":
    main()
