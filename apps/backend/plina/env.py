"""Settings read from the environment (README: Backend URL and ports,
Deployment with Docker)."""
import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

TRUE = {"1", "true", "yes", "on"}
FALSE = {"0", "false", "no", "off"}


def bool_from_env(name: str, default: bool) -> bool:
    """``1/0``, ``true/false``, ``yes/no`` or ``on/off``; unset or empty means
    ``default``. Anything else is an error rather than a guess."""
    value = os.environ.get(name, "").strip().lower()
    if not value:
        return default
    if value in TRUE:
        return True
    if value in FALSE:
        return False
    raise ImproperlyConfigured(f"{name} must be 1 or 0 (true/false, yes/no, on/off), not {value!r}.")


def list_from_env(name: str, default: list[str]) -> list[str]:
    """The comma-separated values in ``name``; unset means ``default``, set
    but empty means none."""
    value = os.environ.get(name)
    if value is None:
        return list(default)
    return [part.strip() for part in value.split(",") if part.strip()]


def origins_from_env(name: str, default: list[str]) -> list[str]:
    """The comma-separated origins in the environment variable ``name``.

    Unset means ``default``; set but empty means no origin. Trailing slashes
    are dropped (``http://localhost:5174/`` is the same origin); anything else
    malformed is reported by django-cors-headers' system checks at startup.
    """
    origins = (origin.rstrip("/") for origin in list_from_env(name, default))
    return [origin for origin in origins if origin]


def secret_from_env(name: str) -> str | None:
    """The value of ``name``, or the content of the file ``name_FILE`` names
    (Docker secrets); None when neither is set."""
    path = os.environ.get(f"{name}_FILE")
    if path:
        return Path(path).read_text().strip()
    return os.environ.get(name) or None


def database_from_env(base_dir: Path) -> dict:
    """The database from ``DB_ENGINE``, ``DB_NAME``, ``DB_USER``,
    ``DB_PASSWORD`` (or ``DB_PASSWORD_FILE``), ``DB_HOST`` and ``DB_PORT``;
    without ``DB_ENGINE`` SQLite at ``DB_NAME`` (default: db.sqlite3)."""
    engine = os.environ.get("DB_ENGINE") or "django.db.backends.sqlite3"
    if engine == "django.db.backends.sqlite3":
        return {"ENGINE": engine, "NAME": Path(os.environ.get("DB_NAME") or base_dir / "db.sqlite3")}
    return {
        "ENGINE": engine,
        "NAME": os.environ.get("DB_NAME", "plina"),
        "USER": os.environ.get("DB_USER", "plina"),
        "PASSWORD": secret_from_env("DB_PASSWORD") or "",
        "HOST": os.environ.get("DB_HOST", "db"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
    }
