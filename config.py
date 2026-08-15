"""Environment-driven configuration for the Shopping Tools backend.

Every value is read from the environment *at call time* (functions, not frozen
constants) so tests and `.env` overrides behave predictably. Defaults match the
VPS deployment described in README.md.

All variables use the `SHOPPING_TOOLS_` prefix and are optional; the defaults
work out of the box. `.env` is loaded by server.py at startup (real environment
variables always win over the file).
"""
import os

APP_NAME = "shopping-tools-backend"
APP_VERSION = "1.0.0"

# Default Menswear Watcher database per the project spec. Override with
# SHOPPING_TOOLS_DB_PATH if your copy of seen.db lives elsewhere (for example
# the syncthing-shared checkout on this VPS). See implementation-notes.md.
DEFAULT_SEEN_DB = "/home/elliot/Projects/1_projects/Menswear Watcher/seen.db"


def host() -> str:
    """Bind address. Default 0.0.0.0 so the Mac apps can reach the VPS."""
    return os.environ.get("SHOPPING_TOOLS_HOST", "0.0.0.0")


def port() -> int:
    """HTTP port. Default 8091, configurable with SHOPPING_TOOLS_PORT."""
    return _env_int("SHOPPING_TOOLS_PORT", 8091)


def searxng_url() -> str:
    """Base URL of the local SearXNG JSON endpoint used by /api/search."""
    return os.environ.get(
        "SHOPPING_TOOLS_SEARXNG_URL", "http://127.0.0.1:8888/search"
    )


def seen_db_path() -> str:
    """Path of the Menswear Watcher SQLite store (opened read-only)."""
    return os.environ.get("SHOPPING_TOOLS_DB_PATH", DEFAULT_SEEN_DB)


def search_timeout() -> float:
    """Per-retailer SearXNG request timeout in seconds."""
    return _env_float("SHOPPING_TOOLS_SEARCH_TIMEOUT", 10.0)


def max_results_per_retailer() -> int:
    """Cap on the number of results returned per retailer."""
    return _env_int("SHOPPING_TOOLS_MAX_RESULTS_PER_RETAILER", 20)


def searxng_engines() -> list:
    """Comma-separated engine override for SearXNG queries.

    Empty by default, which lets SearXNG use its configured default engines.
    Set SHOPPING_TOOLS_SEARXNG_ENGINES=bing to pin a working engine when the
    defaults are suspended or captcha-blocked.
    """
    raw = os.environ.get("SHOPPING_TOOLS_SEARXNG_ENGINES", "")
    return [part.strip() for part in raw.split(",") if part.strip()]


def discovery_api_token() -> str:
    return os.environ.get("DISCOVERY_API_TOKEN", "").strip()


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
