"""Small, source-specific adapters for the first reviewable vertical slice."""
import html
import hashlib
import json
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


def fetch_craigslist(keywords, max_price=50, limit=40):
    # Craigslist's static endpoint treats literal OR terms inconsistently;
    # use the canonical first term and let later scheduled runs cover variants.
    query = keywords[0] if keywords else "patio table"
    url = "https://newyork.craigslist.org/search/fua?" + urlencode({"query": query, "max_price": int(max_price), "availability": 0})
    request = Request(url, headers={"User-Agent": "DiscoveryReview/1.0"})
    with urlopen(request, timeout=20) as response:
        body = response.read().decode("utf-8", "replace")
    parser = CraigslistParser()
    parser.feed(body)
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
    findings = []
    for item in parser.items[:limit]:
        price = item["price"]
        findings.append({
            "search_id": "patio",
            "kind": "goods",
            "source": "craigslist",
            "source_id": item["url"].rsplit("/", 1)[-1],
            "title": item["title"],
            "url": item["url"],
            "image_url": images.get(item["title"], ""),
            "price": price,
            "is_free": price == 0,
            "location": item["location"],
            "description": "Indexed Craigslist result. Open the original listing for the full description and pickup details.",
            "score": _score(item["title"], price),
            "score_reasons": _reasons(item["title"], price),
            "freshness": "new",
            "raw": item,
        })
    return findings


def _score(title, price):
    text = title.lower()
    score = 55
    if price == 0:
        score += 25
    elif price is not None and price <= 25:
        score += 15
    elif price is not None and price <= 50:
        score += 8
    if any(word in text for word in ("patio", "outdoor", "garden", "bistro", "teak")):
        score += 12
    if any(word in text for word in ("broken", "rot", "mold", "unstable")):
        score -= 35
    return max(0, min(100, score))


def _reasons(title, price):
    reasons = []
    if price == 0:
        reasons.append("free")
    elif price is not None and price <= 50:
        reasons.append("within $50 budget")
    if any(word in title.lower() for word in ("patio", "outdoor", "garden", "bistro", "teak")):
        reasons.append("outdoor/table keyword")
    return reasons


def load_jobs(directory, limit=400):
    findings = []
    seen_urls = set()
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
            if any(word in text.lower() for word in ("policy", "civic", "public", "arts", "media")):
                score += 15
                reasons.append("profile keyword")
            findings.append({
                "search_id": "jobs",
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
