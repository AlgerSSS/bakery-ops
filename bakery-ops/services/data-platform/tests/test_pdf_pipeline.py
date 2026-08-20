from typing import Any

import pytest

from hotcrush_data_platform import pdf_pipeline
from hotcrush_data_platform.pdf_pipeline import (
    DeterministicTestEmbedder,
    PageText,
    chunk_pages,
)


def test_chunking_preserves_page_citations_and_overlap() -> None:
    pages = [PageText(3, "A" * 900 + "。" + "B" * 900, False)]
    chunks = chunk_pages(pages, target_characters=1000, overlap_characters=100)
    assert len(chunks) == 2
    assert all(chunk.page_from == 3 and chunk.page_to == 3 for chunk in chunks)
    assert [chunk.chunk_no for chunk in chunks] == [0, 1]
    assert len(chunks[0].content_sha256) == 64


def test_deterministic_test_embeddings_are_stable_and_1536_dimensional() -> None:
    embedder = DeterministicTestEmbedder()
    first, second = embedder.embed(["opening checklist", "opening checklist"])
    assert first == second
    assert len(first) == 1536


def test_ocr_runtime_fails_before_claiming_work_when_tesseract_is_missing(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(pdf_pipeline.shutil, "which", lambda _name: None)

    with pytest.raises(RuntimeError, match="tesseract executable is required"):
        pdf_pipeline.verify_ocr_runtime()
