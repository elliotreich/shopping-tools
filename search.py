"""SearXNG client and safe result parsing for /api/search.

Only title/url/snippet are surfaced, and only http(s) URLs with non-empty
titles are kept — nothing else from the upstream payload is forwarded. Each
retailer query is isolated: one failing retailer produces an error entry but
never sinks the whole request.
"""
import json
import urllib.parse
import urllib.request

import config
import retailers

USER_AGENT = "ShoppingToolsBackend/1.0"

# Length caps applied to every extracted field.
_TITLE_MAX = 300
_URL_MAX = 2048
_SNIPPET_MAX = 800


def _clean_text(value, max_len: int) -> str:
    """Coerce to str, strip control characters, strip, and cap length."""
    if value is None:
        return ""
    text = str(value)
    # Drop C0/C1 control characters except tab/newline are fine to keep; we
    # remove everything below space plus DEL so JSON stays clean.
    text = "".join(ch for ch in text if ch >= " " and ch != "\x7f")
    text = text.strip()
    if len(text) > max_len:
        text = text[:max_len].rstrip() + "…"
    return text


def _safe_result(item) -> dict | None:
    """Extract a safe {title, url, snippet} dict from one SearXNG result item.

    Returns None for items without a title/url or with a non-http(s) URL.
    """
    title = _clean_text(item.get("title"), _TITLE_MAX)
    url = _clean_text(item.get("url"), _URL_MAX)
    snippet = _clean_text(item.get("content") or item.get("snippet"), _SNIPPET_MAX)
    if not title or not url:
        return None
    if not url.startswith(("http://", "https://")):
        return None
    return {"title": title, "url": url, "snippet": snippet}


def parse_results(payload) -> list:
    """Parse a SearXNG JSON payload into a list of safe result dicts.

    Malformed payloads yield an empty list. Results are deduplicated by URL.
    """
    try:
        results = payload.get("results") or []
    except AttributeError:
        return []
    if not isinstance(results, list):
        return []
    out, seen = [], set()
    for item in results:
        safe = _safe_result(item)
        if not safe:
            continue
        if safe["url"] in seen:
            continue
        seen.add(safe["url"])
        out.append(safe)
    return out


def fetch_json(search_url: str, params: dict, timeout: float):
    """GET a SearXNG JSON endpoint. Raises on network/HTTP/JSON errors.

    Split out so tests can patch it without spinning up a real SearXNG.
    """
    url = search_url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    return json.loads(body)


def query_retailer(retailer_id, query, search_url=None, timeout=None, max_results=None):
    """Run one retailer query against SearXNG.

    Returns (retailer_dict | None, results, error | None). A network/HTTP/JSON
    failure is captured in `error`; results is always a list.
    """
    search_url = search_url or config.searxng_url()
    timeout = config.search_timeout() if timeout is None else timeout
    max_results = (
        config.max_results_per_retailer() if max_results is None else max_results
    )
    retailer = retailers.by_id(retailer_id)
    if not retailer:
        return None, [], f"unknown retailer: {retailer_id}"
    params = {"q": f"{query} site:{retailer['domain']}", "format": "json"}
    engines = config.searxng_engines()
    if engines:
        params["engines"] = ",".join(engines)
    try:
        payload = fetch_json(search_url, params, timeout)
    except Exception as exc:  # one bad retailer should not sink the request
        return retailer, [], f"{type(exc).__name__}: {exc}"
    return retailer, parse_results(payload)[:max_results], None


def search(query, selected_ids=None):
    """Query SearXNG for each selected retailer (default: all).

    Returns (retailer_blocks, errors) where each block is
    {"retailer", "name", "domain", "results", "error"}.
    """
    if selected_ids is None:
        selected_ids = retailers.ids()
    blocks, errors = [], []
    for retailer_id in selected_ids:
        retailer, results, err = query_retailer(retailer_id, query)
        if retailer is None:
            errors.append(err)
            continue
        blocks.append(
            {
                "retailer": retailer["id"],
                "name": retailer["name"],
                "domain": retailer["domain"],
                "results": results,
                "error": err,
            }
        )
        if err:
            errors.append(f"{retailer['id']}: {err}")
    return blocks, errors


def ping(search_url=None, timeout: float = 2.0) -> bool:
    """True if the SearXNG endpoint answers (used by /api/health).

    SearXNG rejects query-less requests with a 400, so a trivial query is
    sent to distinguish "up" from "wrong URL".
    """
    search_url = search_url or config.searxng_url()
    try:
        fetch_json(search_url, {"q": "health", "format": "json"}, timeout)
        return True
    except Exception:
        return False
