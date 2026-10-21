"""Application configuration loaded from environment variables / .env file."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # General
    APP_NAME: str = "VaniTTS - Blog Narration Studio"
    APP_ENV: str = "development"
    HOST: str = "0.0.0.0"
    PORT: int = 8006

    # Input / chunking
    MAX_INPUT_CHARS: int = 20000
    CHUNK_MAX_CHARS: int = 1500
    CHUNK_SILENCE_MS: int = 400

    # TTS defaults
    DEFAULT_ENGINE: str = "edge"  # "edge" (free) | "google" (premium)
    DEFAULT_VOICE_HI: str = "hi-IN-SwaraNeural"
    #DEFAULT_VOICE_EN: str = "en-IN-NeerjaNeural"
    DEFAULT_VOICE_EN: str = "en-IN-NeerjaExpressiveNeural"

    # Widget article player (auto-generate on page load)
    WIDGET_ENGINE: str = "edge"
    WIDGET_VOICE: str = "en-IN-NeerjaExpressiveNeural"

    # Jobs / retention
    JOB_TTL_SECONDS: int = 3600
    PERSIST_HISTORY: bool = True

    # Storage
    DATA_DIR: str = "./data"
    AUDIO_DIR_NAME: str = "audio"
    DATABASE_URL: str = "sqlite:///./data/tts.db"

    # Premium engine credentials (optional)
    GOOGLE_APPLICATION_CREDENTIALS: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()