"""Source adapters shared by every discovery search."""
import hashlib
import html
import json
import os
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class CraigslistParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items = []
        self.current = None
        self.capture = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set((attrs.get("class") or "").split())
        if tag == "li" and "cl-static-search-result" in classes:
            self.current = {"title": html.unescape(attrs.get("title", "")), "url": "", "price": None, "location": ""}
        elif self.current and tag == "a" and attrs.get("href"):
            self.current["url"] = attrs["href"]
        elif self.current and tag == "div" and "price" in classes:
            self.capture = "price"
        elif self.current and tag == "div" and "location" in classes:
            self.capture = "location"

    def handle_data(self, data):
        if self.current and self.capture:
            value = " ".join(data.split())
            if not value:
                return
            if self.capture == "price":
                match = re.search(r"\$([0-9,]+)", value)
                if match:
                    self.current["price"] = float(match.group(1).replace(",", ""))
            else:
                self.current["location"] = value

    def handle_endtag(self, tag):
        if tag == "li" and self.current:
            if self.current.get("url") and self.current.get("title"):
                self.items.append(self.current)
            self.current = None
            self.capture = None


def _score_goods(title, price, profile):
    text = title.lower()
    budget = profile.get("budget")
    positive = tuple(value.lower() for value in profile.get("positive_keywords", []))
    negative = tuple(value.lower() for value in profile.get("negative_keywords", []))
    score = 45
    if price == 0:
        score += 25
    elif price is not None and budget is not None and price <= budget:
        score += 18 if price <= min(25, budget) else 10
    elif price is None:
        score += 2
    for keyword in positive:
        if keyword in text:
            score += 4
    for keyword in negative:
        if keyword in text:
            score -= 18
    return max(0, min(100, score))


def _score_reasons(title, price, profile):
    text = title.lower()
    budget = profile.get("budget")
    reasons = []
    if price == 0:
        reasons.append("free")
    elif price is not None and budget is not None and price <= budget:
        reasons.append(f"within ${int(budget)} budget")
    elif price is None:
        reasons.append("price needs confirmation")
    positive = [value for value in profile.get("positive_keywords", []) if value.lower() in text]
    if positive:
        reasons.append(f"profile match: {', '.join(positive[:3])}")
    if profile.get("vehicle"):
        reasons.append(f"transport: {profile['vehicle']}")
    return reasons


def _normalize_goods(item, search_id, profile, source, image_url=""):
    text = f"{item.get('title', '')} {item.get('description', '')}".lower()
    hard_rejects = tuple(value.lower() for value in profile.get("hard_reject_keywords", []))
    if any(keyword in text for keyword in hard_rejects):
        return None
    price = item.get("price")
    if price is not None and profile.get("budget") is not None and price > profile["budget"]:
        return None
    return {
        "search_id": search_id,
        "kind": "goods",
        "source": source,
        "source_id": item["url"].split("?")[0].rstrip("/").rsplit("/", 1)[-1],
        "title": item.get("title", "Untitled listing")[:240],
        "url": item["url"].split("?")[0],
        "image_url": image_url or item.get("image_url", ""),
        "price": price,
        "is_free": price == 0,
        "location": item.get("location", "") or profile.get("location", ""),
        "description": item.get("description") or f"Indexed {source} result. Open the original listing for the full description and pickup details.",
        "score": _score_goods(item.get("title", ""), price, profile),
        "score_reasons": _score_reasons(item.get("title", ""), price, profile),
        "freshness": "new",
        "raw": {**item, "profile_key": profile.get("profile_key", search_id)},
    }


def _craigslist_page(query, max_price):
    url = "https://newyork.craigslist.org/search/fua?" + urlencode({"query": query, "max_price": int(max_price), "availability": 0})
    request = Request(url, headers={"User-Agent": "DiscoveryReview/1.0"})
    with urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8", "replace")


def _images_from_page(body):
    images = {}
    for match in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', body, re.S):
        try:
            data = json.loads(html.unescape(match))
        except json.JSONDecodeError:
            continue
        for entry in data.get("itemListElement", []) if isinstance(data, dict) else []:
            item = entry.get("item", {})
            name = item.get("name")
            image = item.get("image", [])
            if name and image:
                images[html.unescape(name)] = image[0]
    return images


def fetch_craigslist_for_search(search, limit=40):
    profile = search["profile"]
    findings = []
    errors = []
    rejected = 0
    seen = set()
    queries = profile.get("keywords") or ["patio table"]
    max_price = profile.get("budget", 50)
    for query in queries:
        try:
            body = _craigslist_page(query, max_price)
        except Exception as exc:
            errors.append(f"Craigslist {query}: {type(exc).__name__}: {exc}")
            continue
        parser = CraigslistParser()
        parser.feed(body)
        images = _images_from_page(body)
        for item in parser.items:
            normalized = _normalize_goods(item, search["id"], profile, "craigslist", images.get(item["title"], ""))
            if not normalized:
                rejected += 1
            elif normalized["source_id"] not in seen:
                seen.add(normalized["source_id"])
                findings.append(normalized)
                if len(findings) >= limit:
                    return findings, errors, rejected
    return findings, errors, rejected


def fetch_craigslist(keywords, max_price=50, search_id="patio", profile=None, limit=40):
    """Compatibility wrapper for callers that only have keyword lists."""
    profile = profile or {
        "profile_key": search_id,
        "keywords": keywords,
        "budget": max_price,
        "location": "NYC metro",
        "positive_keywords": keywords,
        "negative_keywords": [],
        "hard_reject_keywords": [],
    }
    findings, _, _ = fetch_craigslist_for_search({"id": search_id, "profile": profile}, limit=limit)
    return findings


def _searxng_url():
    return os.environ.get("SHOPPING_TOOLS_SEARXNG_URL", "http://127.0.0.1:8888/search")


def fetch_facebook_indexed(search, limit=40):
    """Fetch public/indexed Marketplace leads without login or messaging."""
    profile = search["profile"]
    findings = []
    errors = []
    rejected = 0
    seen = set()
    for query in profile.get("keywords", []):
        params = urlencode({"q": f"site:facebook.com/marketplace/item {query}", "format": "json", "categories": "general"})
        try:
            request = Request(f"{_searxng_url()}?{params}", headers={"User-Agent": "DiscoveryReview/1.0"})
            with urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8", "replace"))
        except Exception as exc:
            errors.append(f"Facebook indexed {query}: {type(exc).__name__}: {exc}")
            continue
        for result in payload.get("results", []):
            url = result.get("url", "")
            if "facebook.com/marketplace/item/" not in url:
                continue
            match = re.search(r"/marketplace/item/(\d+)", url)
            if not match:
                continue
            title = re.sub(r"\s*\|\s*Facebook.*$", "", result.get("title", "")).strip()
            snippet = result.get("content", "")
            text = f"{title} {snippet}"
            price_match = re.search(r"\$([0-9,]+(?:\.\d{2})?)", text)
            price = float(price_match.group(1).replace(",", "")) if price_match else (0.0 if re.search(r"\bfree\b|\$0\b", text, re.I) else None)
            item = {"url": url, "title": title, "description": snippet[:500], "price": price, "image_url": result.get("img_src", result.get("thumbnail", ""))}
            normalized = _normalize_goods(item, search["id"], profile, "facebook", item["image_url"])
            if not normalized:
                rejected += 1
            else:
                normalized["source_id"] = f"fb:{match.group(1)}"
                if normalized["source_id"] not in seen:
                    seen.add(normalized["source_id"])
                    findings.append(normalized)
                    if len(findings) >= limit:
                        return findings, errors, rejected
    return findings, errors, rejected


def load_jobs(directory, profile=None, search_id="jobs", limit=400):
    profile = profile or {"keywords": ["policy", "civic", "arts", "media", "public service"]}
    findings = []
    seen_urls = set()
    profile_keywords = tuple(value.lower() for value in profile.get("keywords", []))
    for path in sorted(Path(directory).glob("jobs-*.json")):
        try:
            records = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for job in records:
            if job.get("archived") or not job.get("url") or not job.get("role"):
                continue
            if job["url"] in seen_urls:
                continue
            seen_urls.add(job["url"])
            location = job.get("location", "")
            text = " ".join(str(job.get(key, "")) for key in ("org", "role", "description", "track"))
            score = 50
            reasons = []
            if "new york" in location.lower() or "nyc" in location.lower():
                score += 25
                reasons.append("NYC location")
            matched = [word for word in profile_keywords if word in text.lower()]
            if matched:
                score += 15
                reasons.append(f"profile keyword: {matched[0]}")
            findings.append({
                "search_id": search_id,
                "kind": "jobs",
                "source": job.get("source") or path.stem,
                "source_id": f"{job.get('source') or path.stem}:{hashlib.sha256(job['url'].encode()).hexdigest()[:20]}",
                "title": job.get("role", "Untitled role"),
                "url": job["url"],
                "image_url": "",
                "location": location,
                "description": job.get("description", "") or "Job discovery record; open the original listing for full requirements.",
                "score": min(score, 100),
                "fit_score": min(score, 100),
                "score_reasons": reasons,
                "discovered_at": job.get("discovered") or job.get("added"),
                "company": job.get("org", ""),
                "role": job.get("role", ""),
                "salary": job.get("pay", ""),
                "application_status": job.get("app_status") or job.get("status") or "not-reviewed",
                "freshness": "new",
                "raw": job,
            })
    findings.sort(key=lambda item: (item.get("score") or 0, item.get("discovered_at") or ""), reverse=True)
    return findings[:limit]
