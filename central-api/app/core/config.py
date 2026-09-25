from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="CBT_", extra="ignore")

    database_url: str = "postgresql+psycopg://cbt:cbt@localhost:5432/cbt"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60

    anthropic_api_key: str | None = None
    llm_model: str = "claude-sonnet-5"

    # How many candidates' worth of extra questions to bundle in the offline
    # pool so per-candidate randomization has room to work with.
    exam_pool_multiplier: float = 3.0

    # Default share of a generated exam pool that must come from vetted past
    # questions vs. AI-drafted-from-study-material questions. Overridable per exam.
    default_past_question_ratio: float = 0.7

    package_storage_dir: str = "./data/packages"
    document_storage_root: str = "./data/documents"


@lru_cache
def get_settings() -> Settings:
    return Settings()
