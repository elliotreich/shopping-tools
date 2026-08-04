"""Environment-driven configuration for the Resale Watcher backend.

Every value is read from the environment *at call time* (functions, not frozen
constants) so tests and `.env` overrides behave predictably.

All variables use the `SHOPPING_TOOLS_` prefix and are optional; the defaults
work out of the box. `.env` is loaded by server.py at startup (real environment
variables always win over the file).
"""
import os

APP_NAME = "resale-watcher-backend"
APP_VERSION = "1.0.0"

# Supply a SQLite database that follows the documented resale-feed schema, or
# leave the default in place to see a clear 503 until one is configured.
DEFAULT_SEEN_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "resale.sqlite3")


def host() -> str:
    """Bind address for a local or self-hosted deployment."""
    return os.environ.get("SHOPPING_TOOLS_HOST", "0.0.0.0")


def port() -> int:
    """HTTP port. Default 8091, configurable with SHOPPING_TOOLS_PORT."""
    return _env_int("SHOPPING_TOOLS_PORT", 8091)


def seen_db_path() -> str:
    """Path of the resale-feed SQLite store (opened read-only)."""
    return os.environ.get("SHOPPING_TOOLS_DB_PATH", DEFAULT_SEEN_DB)


def load_env_file(path=None) -> bool:
    """Load KEY=VALUE pairs from a .env file into os.environ.

    Never overwrites variables already set in the real environment (the real
    environment wins over the file). A missing file is not an error.
    Returns True if a file was loaded.
    """
    if path is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(path):
        return False
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())
    return True


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
