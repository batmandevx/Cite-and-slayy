"""Local sentence embeddings (all-MiniLM-L6-v2). Vectors are L2-normalised, so dot = cosine."""
from __future__ import annotations

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import numpy as np

from backend.common.config import get_settings


# One model, loaded once, used by one thread at a time: concurrent loading/encoding from several worker threads can
# deadlock PyTorch on CPU (seen when two searches embed at the same moment).
_lock = threading.Lock()
# All async embedding runs on this one dedicated thread: PyTorch on CPU can deadlock when different pool threads
# take turns driving the same model (seen as an idle, never-finishing request).
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="embed")


@lru_cache
def _model():
    from sentence_transformers import SentenceTransformer
    name = get_settings().embedding_model
    try:   # use the local copy without phoning the model hub (that network check can stall a cold start)
        return SentenceTransformer(name, device="cpu", local_files_only=True)
    except Exception:  # noqa: BLE001 - not downloaded yet: fetch it once
        return SentenceTransformer(name, device="cpu")


def embed(texts: list[str], batch_size: int = 64) -> np.ndarray:
    if not texts:
        return np.zeros((0, 384), dtype=np.float32)
    with _lock:   # also guards the first (lazy) load
        return np.asarray(_model().encode(texts, batch_size=batch_size, normalize_embeddings=True,
                                          show_progress_bar=False), dtype=np.float32)


async def embed_async(texts: list[str]) -> np.ndarray:
    return await asyncio.get_running_loop().run_in_executor(_executor, embed, texts)


def cosine(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return a @ b.T
