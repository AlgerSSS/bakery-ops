#!/usr/bin/env python3
"""Execute the R6A1 compiler from the exact no-follow bytes it attests."""

from __future__ import annotations

import os
from pathlib import Path
import stat


MAX_COMPILER_BYTES = 10_000_000


def _read_compiler_bytes() -> tuple[Path, bytes]:
    root = Path(__file__).resolve().parent
    root_descriptor = os.open(
        root,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0),
    )
    try:
        descriptor = os.open(
            "compiler.py",
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=root_descriptor,
        )
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode):
                raise RuntimeError("compiler.py is not a regular file")
            chunks: list[bytes] = []
            size = 0
            while True:
                chunk = os.read(descriptor, 1024 * 1024)
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                if size > MAX_COMPILER_BYTES:
                    raise RuntimeError("compiler.py exceeds bootstrap byte limit")
            content = b"".join(chunks)
            after = os.fstat(descriptor)
            identity_before = (
                before.st_dev,
                before.st_ino,
                before.st_size,
                before.st_mtime_ns,
                before.st_ctime_ns,
            )
            identity_after = (
                after.st_dev,
                after.st_ino,
                after.st_size,
                after.st_mtime_ns,
                after.st_ctime_ns,
            )
            if identity_before != identity_after or len(content) != before.st_size:
                raise RuntimeError("compiler.py changed during bootstrap read")
            return root / "compiler.py", content
        finally:
            os.close(descriptor)
    finally:
        os.close(root_descriptor)


def main() -> None:
    compiler_path, compiler_bytes = _read_compiler_bytes()
    namespace = {
        "__file__": str(compiler_path),
        "__name__": "__main__",
        "__package__": None,
        "__r6a1_executed_source_bytes__": compiler_bytes,
    }
    code = compile(compiler_bytes, str(compiler_path), "exec", dont_inherit=True)
    exec(code, namespace, namespace)


if __name__ == "__main__":
    main()
