# Cite and Slayy backend (FastAPI). CPU-only: embeddings run on CPU, the LLM is Gemini (or another API).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/hf DATA_DIR=/data

WORKDIR /app

# CPU-only torch first (the default Linux wheel pulls ~3 GB of CUDA libraries we don't need).
RUN pip install torch==2.14.0 --index-url https://download.pytorch.org/whl/cpu
COPY deploy/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

# Bake the embedding model into the image so the first request isn't a 90 MB download.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

COPY backend ./backend
COPY data ./data
COPY demo ./demo
COPY scripts ./scripts

VOLUME ["/data"]
EXPOSE 8000
# One worker on purpose: jobs and their live progress streams live in this process.
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
