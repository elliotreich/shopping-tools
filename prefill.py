"""Offer prefill for Shelf Scout: turn SearXNG result text into structured
price/size/unit candidates for /api/prefill.

Parsing is pure (no network); search.search() supplies the result blocks and
this module flattens them into offer candidates.
"""
import re

import search

_PRICE_RE = re.compile(r"\$\s*(\d+(?:\.\d{1,2})?)")
_PRICE_BARE_RE = re.compile(r"(?<!\d)(\d+(?:\.\d{2}))\s*(?:for|each|ea\.?)", re.I)
_SIZE_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(fl\s?oz|oz|lbs?|grams?|kg|ml|l\b|gals?|qts?|pts?|cups?"
    r"|ct|count|each|rolls?|sheets?|pods?|packs?|cases?|bars?|servings?)\b",
    re.I,
)
_DEAL_MULTI_RE = re.compile(r"(\d+)\s+for\s+\$\s*(\d+(?:\.\d{1,2})?)", re.I)
_DEAL_BOGO_RE = re.compile(r"buy\s+(\d+)\s+get\s+(\d+)", re.I)
_DEAL_PCT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%\s*off", re.I)
_DEAL_FIXED_RE = re.compile(r"save\s+\$\s*(\d+(?:\.\d{1,2})?)", re.I)

_UNIT_MAP = {
    "oz": ("weight", "oz"),
    "lb": ("weight", "lb"),
    "lbs": ("weight", "lb"),
    "g": ("weight", "g"),
    "grams": ("weight", "g"),
    "kg": ("weight", "kg"),
    "floz": ("volume", "fl oz"),
    "ml": ("volume", "ml"),
    "l": ("volume", "L"),
    "gal": ("volume", "gal"),
    "gals": ("volume", "gal"),
    "qt": ("volume", "qt"),
    "qts": ("volume", "qt"),
    "pt": ("volume", "pt"),
    "pts": ("volume", "pt"),
    "cup": ("volume", "cup"),
    "cups": ("volume", "cup"),
    "ct": ("count", "each"),
    "count": ("count", "each"),
    "each": ("count", "each"),
    "roll": ("count", "roll"),
    "rolls": ("count", "roll"),
    "sheet": ("count", "sheet"),
    "sheets": ("count", "sheet"),
    "pod": ("count", "pod"),
    "pods": ("count", "pod"),
    "pack": ("count", "pack"),
    "packs": ("count", "pack"),
    "case": ("count", "case"),
    "cases": ("count", "case"),
    "bar": ("count", "bar"),
    "bars": ("count", "bar"),
    "serving": ("count", "serving"),
    "servings": ("count", "serving"),
}


def parse_offer(text) -> dict | None:
    """Parse a price + size + optional deal out of one text blob.

    Returns a dict with keys price, size, unitType, unit, deal, or None when a
    usable price or size cannot be found. A "2 for $10" deal sets price to the
    per-item price (5.00) so the client never double-counts the deal.
    """
    if not text:
        return None

    price = None
    deal = None
    multi = _DEAL_MULTI_RE.search(text)
    if multi:
        n = int(multi.group(1))
        total = float(multi.group(2))
        if n > 0 and total > 0:
            price = total / n
            deal = {"type": "multi", "value": n, "extra": total}
    if price is None:
        price_match = _PRICE_RE.search(text)
        if price_match:
            price = float(price_match.group(1))
        else:
            bare = _PRICE_BARE_RE.search(text)
            if bare:
                price = float(bare.group(1))
    if price is None or price <= 0:
        return None

    size_match = _SIZE_RE.search(text)
    if not size_match:
        return None
    unit_info = _UNIT_MAP.get(size_match.group(2).lower().replace(" ", ""))
    if unit_info is None:
        return None

    if deal is None:
        bogo = _DEAL_BOGO_RE.search(text)
        if bogo:
            deal = {
                "type": "bogo",
                "value": int(bogo.group(1)),
                "extra": int(bogo.group(2)),
            }
    if deal is None:
        pct = _DEAL_PCT_RE.search(text)
        if pct:
            deal = {"type": "pct", "value": float(pct.group(1))}
    if deal is None:
        fixed = _DEAL_FIXED_RE.search(text)
        if fixed:
            deal = {"type": "fixed", "value": float(fixed.group(1))}

    return {
        "price": round(price, 2),
        "size": float(size_match.group(1)),
        "unitType": unit_info[0],
        "unit": unit_info[1],
        "deal": deal,
    }


def prefill(query, selected_ids=None, max_candidates=15, per_store=5):
    """Flatten retailer search blocks into parsed offer candidates.

    Returns (candidates, errors). Candidates carry store/retailerId/url/title
    alongside the parsed price/size fields. Errors come straight from
    search.search() (one failing retailer never sinks the request).
    """
    blocks, errors = search.search(query, selected_ids)
    candidates = []
    for block in blocks:
        picked = 0
        for result in block.get("results") or []:
            text = (result.get("title") or "") + "\n" + (result.get("snippet") or "")
            parsed = parse_offer(text)
            if not parsed:
                continue
            parsed["store"] = block.get("name") or block.get("retailer")
            parsed["retailerId"] = block.get("retailer")
            parsed["url"] = result.get("url")
            parsed["title"] = result.get("title")
            candidates.append(parsed)
            picked += 1
            if picked >= per_store:
                break
        if len(candidates) >= max_candidates:
            break
    return candidates[:max_candidates], errors
