"""Local sentence embeddings (all-MiniLM-L6-v2). Vectors are L2-normalised, so dot = cosine."""
from __future__ import annotations

import asyncio
from functools import lru_cache

import numpy as np

from backend.common.config import get_settings


@lru_cache
def _model():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(get_settings().embedding_model, device="cpu")


def embed(texts: list[str], batch_size: int = 64) -> np.ndarray:
    if not texts:
        return np.zeros((0, 384), dtype=np.float32)
    return np.asarray(_model().encode(texts, batch_size=batch_size, normalize_embeddings=True,
                                      show_progress_bar=False), dtype=np.float32)


async def embed_async(texts: list[str]) -> np.ndarray:
    return await asyncio.to_thread(embed, texts)


def cosine(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return a @ b.T
