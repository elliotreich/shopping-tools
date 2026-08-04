"""Static retailer catalog served by /api/retailers and used by /api/search.

Fields:
  id            — stable slug used in the API and the `retailers` query param
  name          — display name
  domain        — site domain, used to build `site:` queries
  membership    — whether a paid membership is required to buy on the site
  free_delivery — human note about membership/free-delivery conditions

Notes are editorial/general and may drift; keep them factual, not promises.
"""

RETAILERS = [
    {
        "id": "target",
        "name": "Target",
        "domain": "target.com",
        "membership": False,
        "free_delivery": (
            "No membership required. Free standard shipping on orders over "
            "$35 (Target Circle is free to join)."
        ),
    },
    {
        "id": "walmart",
        "name": "Walmart",
        "domain": "walmart.com",
        "membership": False,
        "free_delivery": (
            "No membership required. Free shipping on orders over $35. "
            "Walmart+ is an optional paid membership (~$98/yr) with free "
            "unlimited delivery."
        ),
    },
    {
        "id": "amazon",
        "name": "Amazon",
        "domain": "amazon.com",
        "membership": True,
        "free_delivery": (
            "Prime membership (~$14.99/mo or $139/yr) required for free "
            "delivery on most items; non-Prime orders have free-shipping "
            "thresholds."
        ),
    },
    {
        "id": "homedepot",
        "name": "Home Depot",
        "domain": "homedepot.com",
        "membership": False,
        "free_delivery": (
            "No membership required. Free delivery on eligible orders over "
            "$45 (varies by item). Pro Xtra is a free rewards program."
        ),
    },
    {
        "id": "costco",
        "name": "Costco",
        "domain": "costco.com",
        "membership": True,
        "free_delivery": (
            "Membership required (Gold Star ~$60/yr, Executive ~$120/yr). "
            "Free 2-day delivery on many items with membership."
        ),
    },
]


def by_id(retailer_id: str):
    """Return the retailer dict for an id, or None if unknown."""
    for retailer in RETAILERS:
        if retailer["id"] == retailer_id:
            return retailer
    return None


def ids() -> list:
    """All retailer ids in catalog order."""
    return [retailer["id"] for retailer in RETAILERS]
