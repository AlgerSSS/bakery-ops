from __future__ import annotations

import hashlib
import math
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import pymupdf
from openai import OpenAI


@dataclass(frozen=True)
class PageText:
    page_number: int
    text: str
    used_ocr: bool


@dataclass(frozen=True)
class TextChunk:
    chunk_no: int
    page_from: int
    page_to: int
    section_path: list[str]
    content: str
    content_sha256: str
    token_count: int
    is_redacted: bool = False


class Embedder(Protocol):
    model: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class OpenRouterEmbedder:
    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        self.model = model
        self._client = OpenAI(api_key=api_key, base_url=base_url)

    def embed(self, texts: list[str]) -> list[list[float]]:
        response = self._client.embeddings.create(model=self.model, input=texts)
        rows = sorted(response.data, key=lambda row: row.index)
        embeddings = [row.embedding for row in rows]
        if len(embeddings) != len(texts) or any(len(row) != 1536 for row in embeddings):
            raise ValueError("embedding provider did not return one 1536-dimensional vector per text")
        return embeddings


class DeterministicTestEmbedder:
    """Local-only test vector generator. Settings reject it for non-local Supabase URLs."""

    model = "text-embedding-3-small"

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(text) for text in texts]

    @staticmethod
    def _vector(text: str) -> list[float]:
        values: list[float] = []
        counter = 0
        while len(values) < 1536:
            digest = hashlib.sha512(f"{counter}:{text}".encode()).digest()
            values.extend((byte - 127.5) / 127.5 for byte in digest)
            counter += 1
        values = values[:1536]
        norm = math.sqrt(sum(value * value for value in values)) or 1.0
        return [value / norm for value in values]


def _normalize_text(text: str) -> str:
    lines = [" ".join(line.split()) for line in text.splitlines()]
    return "\n".join(line for line in lines if line).strip()


def _ocr_page(page: pymupdf.Page, languages: str) -> str:
    with tempfile.TemporaryDirectory(prefix="hotcrush-rag-ocr-") as temp_dir:
        image_path = Path(temp_dir) / "page.png"
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(2.5, 2.5), alpha=False)
        pixmap.save(image_path)
        result = subprocess.run(
            ["tesseract", str(image_path), "stdout", "-l", languages, "--psm", "6"],
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0 and languages != "eng":
            result = subprocess.run(
                ["tesseract", str(image_path), "stdout", "-l", "eng", "--psm", "6"],
                check=False,
                capture_output=True,
                text=True,
                timeout=120,
            )
        if result.returncode != 0:
            raise RuntimeError(f"tesseract failed with exit code {result.returncode}")
        return result.stdout


def extract_pdf_pages(
    pdf_bytes: bytes,
    *,
    min_text_characters: int = 80,
    ocr_languages: str = "eng+chi_sim",
) -> list[PageText]:
    pages: list[PageText] = []
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as document:
        if document.page_count < 1:
            raise ValueError("PDF has no pages")
        for index, page in enumerate(document):
            extracted = _normalize_text(page.get_text("text"))
            used_ocr = len(extracted) < min_text_characters
            if used_ocr:
                extracted = _normalize_text(_ocr_page(page, ocr_languages))
            if not extracted:
                raise ValueError(f"page {index + 1} contains no extractable text after OCR")
            pages.append(PageText(index + 1, extracted, used_ocr))
    return pages


def chunk_pages(
    pages: list[PageText],
    *,
    target_characters: int = 2400,
    overlap_characters: int = 240,
    is_redacted: bool = False,
) -> list[TextChunk]:
    if target_characters < 400 or overlap_characters < 0 or overlap_characters >= target_characters:
        raise ValueError("invalid chunk size or overlap")

    chunks: list[TextChunk] = []
    for page in pages:
        start = 0
        while start < len(page.text):
            hard_end = min(start + target_characters, len(page.text))
            end = hard_end
            if hard_end < len(page.text):
                split_at = max(
                    page.text.rfind("\n", start + target_characters // 2, hard_end),
                    page.text.rfind("。", start + target_characters // 2, hard_end),
                    page.text.rfind(". ", start + target_characters // 2, hard_end),
                )
                if split_at > start:
                    end = split_at + 1
            content = page.text[start:end].strip()
            if content:
                chunks.append(
                    TextChunk(
                        chunk_no=len(chunks),
                        page_from=page.page_number,
                        page_to=page.page_number,
                        section_path=[f"Page {page.page_number}"],
                        content=content,
                        content_sha256=hashlib.sha256(content.encode()).hexdigest(),
                        token_count=max(1, math.ceil(len(content) / 4)),
                        is_redacted=is_redacted,
                    )
                )
            if end >= len(page.text):
                break
            start = max(end - overlap_characters, start + 1)
    if not chunks:
        raise ValueError("document produced no chunks")
    return chunks
