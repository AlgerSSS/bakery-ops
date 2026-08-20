import pytest

from hotcrush_data_platform.config import Settings


def test_rag_settings_require_explicit_r6_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("R6_SUPABASE_URL", raising=False)
    monkeypatch.delenv("R6_SUPABASE_SERVICE_KEY", raising=False)
    monkeypatch.delenv("R6_SUPABASE_SERVICE_KEY_FILE", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://old-production.example")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "old-production-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")

    with pytest.raises(ValueError, match="R6_SUPABASE_URL"):
        Settings.from_env()


def test_rag_settings_accept_explicit_r6_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("R6_SUPABASE_URL", "https://r6.example")
    monkeypatch.setenv("R6_SUPABASE_SERVICE_KEY", "r6-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")

    settings = Settings.from_env()

    assert settings.supabase_url == "https://r6.example"
    assert settings.supabase_service_key == "r6-key"


def test_rag_control_plane_does_not_require_an_embedding_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("R6_SUPABASE_URL", "https://r6.example")
    monkeypatch.setenv("R6_SUPABASE_SERVICE_KEY", "r6-key")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY_FILE", raising=False)

    settings = Settings.from_env(require_embedding=False)

    assert settings.openrouter_api_key == ""
