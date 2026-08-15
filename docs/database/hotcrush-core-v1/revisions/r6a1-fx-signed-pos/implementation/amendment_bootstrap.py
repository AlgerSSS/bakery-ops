#!/usr/bin/env python3
"""Byte-carrying trust-root loader for the R6A1 amendment compiler.

The bootstrap is the explicit local trust root.  It opens the compiler once,
compiles and executes those exact bytes, and injects the same immutable bytes
into the compiler input snapshot.  The compiler therefore never attests a
later pathname read as the code that executed.
"""

from __future__ import annotations

import os
import stat
import sys
import types
from pathlib import Path
from types import ModuleType


IMPLEMENTATION_DIR = Path(__file__).resolve().parent
COMPILER_PATH = IMPLEMENTATION_DIR / "amendment_compiler.py"
BOUND_MODULE_NAME = "_hotcrush_r6a1_bound_amendment_compiler"
MAX_COMPILER_BYTES = 8 * 1024 * 1024


class BootstrapError(RuntimeError):
    pass


def _read_compiler_once(path: Path = COMPILER_PATH) -> bytes:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError:
        raise BootstrapError("compiler source is missing or unsafe") from None
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_size <= 0
            or before.st_size > MAX_COMPILER_BYTES
        ):
            raise BootstrapError("compiler source is not a bounded regular file")
        raw = bytearray()
        while len(raw) < before.st_size:
            chunk = os.read(descriptor, min(1024 * 1024, before.st_size - len(raw)))
            if not chunk:
                raise BootstrapError("compiler source changed while read")
            raw.extend(chunk)
        if os.read(descriptor, 1):
            raise BootstrapError("compiler source grew while read")
        after = os.fstat(descriptor)
        identity = lambda value: (
            value.st_dev,
            value.st_ino,
            value.st_mode,
            value.st_size,
            value.st_mtime_ns,
            value.st_ctime_ns,
        )
        if identity(before) != identity(after):
            raise BootstrapError("compiler source metadata changed while read")
        return bytes(raw)
    finally:
        os.close(descriptor)


def load_compiler() -> ModuleType:
    existing = sys.modules.get(BOUND_MODULE_NAME)
    if existing is not None:
        return existing
    raw = _read_compiler_once()
    module = types.ModuleType(BOUND_MODULE_NAME)
    module.__file__ = str(COMPILER_PATH)
    module.__package__ = ""
    module.__dict__["_BOOTSTRAP_BOUND_COMPILER_SOURCE_BYTES"] = raw
    sys.modules[BOUND_MODULE_NAME] = module
    try:
        code = compile(raw, str(COMPILER_PATH), "exec", dont_inherit=True)
        exec(code, module.__dict__)
    except BaseException:
        sys.modules.pop(BOUND_MODULE_NAME, None)
        raise
    return module


def main(argv: list[str] | None = None) -> int:
    try:
        compiler = load_compiler()
    except BootstrapError as exc:
        print(f"ERROR unsafe_bootstrap: {exc}", file=sys.stderr)
        return 2
    return compiler.main(sys.argv[1:] if argv is None else argv)


if __name__ == "__main__":
    raise SystemExit(main())
