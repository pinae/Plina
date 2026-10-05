"""Settings read from the environment (README: Backend URL and ports,
Deployment with Docker)."""
import os
import re
from pathlib import Path
from urllib.parse import urlparse

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
    without ``DB_ENGINE`` SQLite at ``DB_NAME`` (default: db.sqlite3). The
    engine may be given short: ``postgresql``, ``sqlite3``."""
    engine = os.environ.get("DB_ENGINE") or "django.db.backends.sqlite3"
    if "." not in engine:
        engine = f"django.db.backends.{engine}"
    if engine == "django.db.backends.sqlite3":
        # IMMEDIATE: concurrent requests that write wait for each other
        # instead of failing with "database is locked".
        return {"ENGINE": engine, "NAME": Path(os.environ.get("DB_NAME") or base_dir / "db.sqlite3"),
                "OPTIONS": {"transaction_mode": "IMMEDIATE", "timeout": 20}}
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


#: Single sign-on (OpenID Connect): the environment variables it needs, and
#: the mozilla-django-oidc settings they become.
OIDC_REQUIRED = {
    "OIDC_CLIENT_ID": "OIDC_RP_CLIENT_ID",
    "OIDC_CLIENT_SECRET": "OIDC_RP_CLIENT_SECRET",
    "OIDC_AUTHORIZATION_ENDPOINT": "OIDC_OP_AUTHORIZATION_ENDPOINT",
    "OIDC_TOKEN_ENDPOINT": "OIDC_OP_TOKEN_ENDPOINT",
    "OIDC_USER_ENDPOINT": "OIDC_OP_USER_ENDPOINT",
    "OIDC_JWKS_ENDPOINT": "OIDC_OP_JWKS_ENDPOINT",
}
_URL = re.compile(r"^https?://[^/\s]+")


def oidc_from_env() -> dict:
    """The single sign-on's settings when all of ``OIDC_REQUIRED`` are set;
    none of them means local accounts only (an empty dict). Some but not
    all, or a malformed URL, is an error rather than a silent fallback."""
    values = {name: (secret_from_env(name) or "").strip() for name in OIDC_REQUIRED}
    if not any(values.values()):
        return {}
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise ImproperlyConfigured(
            f"Single sign-on needs {', '.join(missing)} as well (or no OIDC_ variables for local accounts only).")
    logout = os.environ.get("OIDC_LOGOUT_ENDPOINT", "").strip()
    redirect = os.environ.get("OIDC_REDIRECT_URL", "").strip()
    urls = {name: value for name, value in values.items() if name.endswith("_ENDPOINT")}
    urls.update({name: value for name, value in [("OIDC_LOGOUT_ENDPOINT", logout), ("OIDC_REDIRECT_URL", redirect)]
                 if value and not (name == "OIDC_REDIRECT_URL" and value.startswith("/"))})
    for name, url in urls.items():
        if not _URL.match(url):
            raise ImproperlyConfigured(f"{name} must be an http(s) URL, not {url!r}.")
    settings = {setting: values[name] for name, setting in OIDC_REQUIRED.items()}
    settings.update(
        OIDC_OP_LOGOUT_ENDPOINT=logout or None,
        # Where the app opens after logging in (unless it asked for a page),
        # and where a failed single sign-on comes back to (the login page).
        LOGIN_REDIRECT_URL=redirect or "/",
        LOGIN_REDIRECT_URL_FAILURE=(redirect or "/") + ("&" if "?" in (redirect or "") else "?") + "login=failed",
        OIDC_PROVIDER_NAME=(os.environ.get("OIDC_PROVIDER_NAME", "").strip()
                            or urlparse(values["OIDC_AUTHORIZATION_ENDPOINT"]).hostname),
        OIDC_RP_SCOPES=os.environ.get("OIDC_SCOPES", "").strip() or "openid email profile",
        OIDC_RP_SIGN_ALGO=os.environ.get("OIDC_SIGN_ALGO", "").strip() or "RS256",
    )
    return settings
