#!/usr/bin/env python3
"""Manual release seal for HOT CRUSH R6 Phase 1 artifacts.

The compiler never edits this file.  A release is executable only after all
three pins are replaced with the exact final byte lengths and SHA-256 values.
"""

from __future__ import annotations

from dataclasses import dataclass


RELEASE_VERSION = 1


@dataclass(frozen=True)
class ArtifactPin:
    filename: str
    bytes: int
    sha256: str


ARTIFACT_PINS = {
    "phase1-ddl-manifest.json": ArtifactPin(
        "phase1-ddl-manifest.json",
        294649,
        "f03ebd6d66462d8720f85a59642769d4655cd6597343401dcf5f4dc62dd0dc66",
    ),
    "phase1.sql": ArtifactPin(
        "phase1.sql",
        1485438,
        "0cdb26dbf255022997c3e167a28f12709b4c73c4ad75d364ed312ff37843176d",
    ),
    "phase1-catalog-contract.json": ArtifactPin(
        "phase1-catalog-contract.json",
        1801975,
        "a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea",
    ),
}
