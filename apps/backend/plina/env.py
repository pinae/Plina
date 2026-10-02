"""Settings read from the environment (README: Backend URL and ports)."""
import os


def origins_from_env(name: str, default: list[str]) -> list[str]:
    """The comma-separated origins in the environment variable ``name``.

    Unset means ``default``; set but empty means no origin. Trailing slashes
    are dropped (``http://localhost:5174/`` is the same origin); anything else
    malformed is reported by django-cors-headers' system checks at startup.
    """
    value = os.environ.get(name)
    if value is None:
        return list(default)
    origins = (part.strip().rstrip("/") for part in value.split(","))
    return [origin for origin in origins if origin]
