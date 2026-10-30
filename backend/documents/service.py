"""Stored documents: uploads, AutoClaw outputs and demo samples."""
from __future__ import annotations

import hashlib
import shutil
from functools import lru_cache
from pathlib import Path

from backend.cache.store import get_store
from backend.common.config import get_settings
from backend.common.schemas import DocumentInfo
from backend.documents.parser import ParsedDocument, parse_document

ALLOWED = {".pdf": "pdf", ".txt": "text"}


class DocumentError(Exception):
    pass


def _dir() -> Path:
    d = get_settings().data_dir / "documents"
    d.mkdir(parents=True, exist_ok=True)
    return d


def path_for(document_id: str) -> Path:
    for ext in ALLOWED:
        p = _dir() / f"{document_id}{ext}"
        if p.exists():
            return p
    raise DocumentError(f"unknown document {document_id}")


def save_bytes(filename: str, data: bytes, title: str | None = None, reuse_cached: bool = False) -> DocumentInfo:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED:
        raise DocumentError("Only .pdf and .txt files are supported")
    if ext == ".pdf" and not data.startswith(b"%PDF"):
        raise DocumentError("File does not look like a PDF")
    doc_id = hashlib.sha256(data).hexdigest()[:16]   # same file -> same id -> cached results reused
    path = _dir() / f"{doc_id}{ext}"
    if reuse_cached and path.exists() and (cached := get_store().get("document", doc_id)):
        if title and cached.get("title") != title:
            cached = {**cached, "title": title}
            get_store().put("document", doc_id, cached)
        return DocumentInfo.model_validate(cached)
    path.write_bytes(data)
    return _register(doc_id, path, filename, title=title)


def save_path(src: Path, filename: str | None = None, title: str | None = None) -> DocumentInfo:
    return save_bytes(filename or src.name, src.read_bytes(), title=title, reuse_cached=True)


def _register(doc_id: str, path: Path, filename: str, title: str | None = None) -> DocumentInfo:
    try:
        parsed = get_parsed.__wrapped__(doc_id, path)  # parse fresh on (re)upload
    except Exception as e:  # PyMuPDF raises various errors on broken files
        path.unlink(missing_ok=True)
        raise DocumentError(f"Could not parse document: {e}") from e
    info = DocumentInfo(document_id=doc_id, filename=filename, kind=ALLOWED[path.suffix.lower()],
                        title=title or parsed.title, doi=parsed.doi, pages=len(parsed.pages),
                        n_references=len(parsed.references), parser=parsed.parser)
    get_store().put("document", doc_id, info)
    return info


def info(document_id: str) -> DocumentInfo:
    d = get_store().get("document", document_id)
    if not d:
        raise DocumentError(f"unknown document {document_id}")
    return DocumentInfo.model_validate(d)


@lru_cache(maxsize=32)
def get_parsed(document_id: str, path: Path | None = None) -> ParsedDocument:
    return parse_document(path or path_for(document_id))


def copy_to(document_id: str, dest: Path) -> None:
    shutil.copy(path_for(document_id), dest)
