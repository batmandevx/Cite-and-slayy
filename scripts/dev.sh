#!/usr/bin/env bash
# Start the FastAPI backend (port 8000) and the Next.js frontend (port 3000) together.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { cp .env.example .env; echo "Created .env from .env.example. Add your keys."; }

uv run uvicorn backend.app.main:app --port 8000 --reload &
BACK=$!
trap 'kill $BACK 2>/dev/null' EXIT

cd frontend
[ -d node_modules ] || npm install
npm run dev -- -p 3000
