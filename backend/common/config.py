"""Runtime configuration, loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    # LLM
    # auto = a running local Ollama model first (free), else Amazon Bedrock if BEDROCK_REGION is set, else cloud keys
    llm_provider: Literal["auto", "anthropic", "openai", "gemini", "bedrock", "ollama", "none"] = "auto"
    llm_fallback: str = ""            # e.g. "gemini" or "gemini,ollama": tried in order when the primary fails
    llm_model: str | None = None        # "main" tier: reviewer jury, research questions (needs judgment)
    llm_model_fast: str | None = None   # "fast" tier: high-volume claim checks and cluster labels
    anthropic_api_key: str | None = None  # unused: Claude runs exclusively via Amazon Bedrock (bedrock_region)
    openai_api_key: str | None = None
    gemini_api_key: str | None = None
    bedrock_region: str | None = None  # Amazon Bedrock (Claude, Kimi, ...); credentials from the AWS chain (EC2 role)
    ollama_url: str = "http://localhost:11434"
    ollama_model: str | None = None   # None = first chat model installed locally

    # Scholarly APIs
    contact_email: str | None = None  # Crossref/OpenAlex "polite pool"
    s2_api_key: str | None = None
    openalex_api_key: str | None = None
    http_timeout: float = 20.0

    # Parsing
    grobid_url: str | None = None

    # Embeddings
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"

    # AutoResearchClaw (external dependency)
    autoclaw_bin: str = "researchclaw"
    autoclaw_config: str | None = None
    autoclaw_workdir: str | None = None
    autoclaw_auto_approve: bool = True

    # App
    demo_mode: bool = False
    data_dir: Path = ROOT / "var"
    cors_origins: str = "http://localhost:3000"
    public_url: str = "http://localhost:3000"   # where users reach the site (magic links, cookie Secure flag)
    api_public_url: str | None = None           # where the browser reaches the API, if not the same origin (local dev)

    # Accounts, plans and billing
    auth_required: bool = False        # true in production: every /api call needs a signed-in user
    secret_key: str | None = None      # signs session cookies; generated into DATA_DIR if unset
    owner_emails: str = ""             # comma-separated dev/owner emails with unlimited access to all paid features
    owner_access_key: str | None = None  # optional secret key letting the dev owner unlock unlimited access on any session
    google_client_id: str | None = None
    smtp_host: str | None = None       # magic-link email (e.g. Amazon SES SMTP); without it, email login is off
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    mail_from: str | None = None
    dev_show_magic_link: bool = False  # local testing only: return the login link in the API response
    premium_model: str = "us.anthropic.claude-opus-4-6-v1"            # Pro/Max engine via Amazon Bedrock (no Anthropic API key needed)
    premium_model_fast: str = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    price_overrides: dict[str, list[float]] | None = None   # USD per 1M tokens per model id, e.g. Bedrock rates
    usd_inr: float = 88.0               # conversion for budgets; update to the current rate
    razorpay_key_id: str | None = None
    razorpay_key_secret: str | None = None
    razorpay_webhook_secret: str | None = None

    def fast_model_for(self, provider: str) -> str:
        """Cheaper model for high-volume, simple tasks. Falls back to the main model where no cheaper tier exists."""
        if self.llm_model_fast and provider == self.llm_provider:
            return self.llm_model_fast
        return {
            "anthropic": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            "bedrock": "moonshotai.kimi-k2.5",   # Claude option for bulk work: us.anthropic.claude-haiku-4-5-20251001-v1:0
        }.get(provider) or self.default_model_for(provider)

    def default_model_for(self, provider: str) -> str:
        if self.llm_model and provider == self.llm_provider:
            return self.llm_model
        return {
            "anthropic": "us.anthropic.claude-sonnet-4-6",
            "openai": "gpt-4.1-mini",
            "gemini": "gemini-2.5-flash",
            "bedrock": "moonshotai.kimi-k2.5",   # fast, cheap, no extra Bedrock agreements; Claude: us.anthropic.claude-sonnet-4-6
            "ollama": self.ollama_model or "",
            "none": "none",
        }.get(provider, "")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    return s
