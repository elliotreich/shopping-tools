"""Unified search templates for the discovery workflow.

Every goods search uses the same runner and review model. The profile only
changes the object-specific search terms, budget, transport constraints, and
quality rules. Jobs remain a separate kind of finding but use the same store.
"""
from copy import deepcopy


def _goods(
    search_id,
    name,
    keywords,
    positive_keywords,
    negative_keywords,
    hard_reject_keywords=(),
    budget=50,
    schedule="30 10 * * *",
    status="paused",
    size_constraints="fits in vehicle; local pickup",
):
    return {
        "id": search_id,
        "name": name,
        "kind": "goods",
        "profile": {
            "profile_key": search_id,
            "keywords": list(keywords),
            "budget": budget,
            "location": "NYC metro",
            "radius_miles": 40,
            "vehicle": "Honda Accord",
            "size_constraints": size_constraints,
            "positive_keywords": list(positive_keywords),
            "negative_keywords": list(negative_keywords),
            "hard_reject_keywords": list(hard_reject_keywords),
        },
        "source_adapters": ["craigslist-indexed", "facebook-public-indexed"],
        "schedule": schedule,
        "status": status,
    }


TEMPLATES = [
    _goods(
        "office-chair",
        "Office chairs (one-time)",
        ("ergonomic office chair", "Herman Miller", "Steelcase Leap", "Haworth", "Humanscale", "office chair"),
        ("ergonomic", "lumbar", "adjustable", "office chair", "tilt", "cylinder"),
        ("mesh sag", "mesh rip", "mesh tear", "broken tilt", "broken cylinder", "bed bugs", "smoke odor"),
        ("broken tilt", "broken cylinder", "bed bugs", "smoke odor"),
        budget=650,
        schedule="30 9 * * *",
        size_constraints="fits in vehicle or disassembles; local pickup",
    ),
    _goods(
        "garage-chair",
        "Garage chill chair (one-time)",
        ("POANG chair", "recliner", "lounge chair", "zero gravity chair", "butterfly chair", "saucer chair", "papasan chair", "folding chair"),
        ("comfortable", "recliner", "lounge", "zero gravity", "folding", "clean", "leather", "outdoor"),
        ("broken", "mold", "mildew", "smoke odor", "bed bugs", "water damage", "unstable"),
        ("mold", "mildew", "smoke odor", "bed bugs", "water damage", "unstable"),
        budget=50,
        schedule="0 10 * * *",
        size_constraints="compact or folding; fits in Honda Accord; local pickup",
    ),
    _goods(
        "patio",
        "Patio tables under $50",
        ("patio table", "outdoor table", "bistro table", "garden table", "teak patio table", "deck table"),
        ("patio", "outdoor", "garden", "bistro", "teak", "acacia", "weather-resistant", "solid wood", "aluminum", "metal frame"),
        ("mold", "mildew", "rot", "rotted", "structural damage", "cracked", "broken leg", "unstable", "missing parts"),
        ("mold", "mildew", "rot", "rotted", "structural damage", "broken leg", "unstable"),
        budget=50,
        schedule="30 8,12,16,20 * * *",
        status="active",
    ),
    _goods(
        "patio-furniture",
        "Patio furniture under $50",
        ("patio furniture", "outdoor chair", "outdoor bench", "patio set", "outdoor loveseat", "porch furniture", "garden furniture"),
        ("patio", "outdoor", "garden", "weather-resistant", "aluminum", "metal", "teak", "folding"),
        ("mold", "mildew", "rot", "rusted through", "broken frame", "unstable", "smoke odor", "bed bugs"),
        ("mold", "mildew", "rot", "rusted through", "broken frame", "unstable", "bed bugs"),
        budget=50,
        schedule="0 11 * * *",
    ),
    _goods(
        "shelving",
        "Shelving and storage under $50",
        ("shelving", "storage shelf", "bookcase", "garage shelving", "metal shelf", "wire shelving", "storage rack"),
        ("shelving", "storage", "adjustable", "metal", "wire", "sturdy", "heavy duty", "bookcase"),
        ("broken", "missing shelf", "wobble", "mold", "water damage", "bed bugs"),
        ("missing shelf", "wobble", "mold", "water damage", "bed bugs"),
        budget=50,
        schedule="30 11 * * *",
        size_constraints="fits in vehicle or disassembles; local pickup",
    ),
    _goods(
        "tools",
        "Tools and workshop equipment under $50",
        ("tools", "power tools", "hand tools", "drill", "saw", "clamps", "toolbox", "workbench"),
        ("tool", "working", "tested", "battery", "charger", "cordless", "steel", "heavy duty"),
        ("broken", "for parts", "missing battery", "missing charger", "rusted", "smoke odor"),
        ("broken", "for parts", "missing battery", "missing charger", "smoke odor"),
        budget=50,
        schedule="0 12 * * *",
        size_constraints="fits in vehicle; local pickup",
    ),
    _goods(
        "appliances",
        "Small appliances under $50",
        ("mini fridge", "microwave", "air purifier", "dehumidifier", "fan", "coffee maker", "small appliance"),
        ("working", "clean", "tested", "quiet", "stainless", "energy efficient"),
        ("broken", "for parts", "leak", "mold", "smoke odor", "bed bugs", "recall"),
        ("broken", "for parts", "leak", "mold", "smoke odor", "bed bugs"),
        budget=50,
        schedule="30 12 * * *",
        size_constraints="small enough for Honda Accord; local pickup",
    ),
    {
        "id": "jobs",
        "name": "Policy, civic, arts, and media jobs",
        "kind": "jobs",
        "profile": {
            "profile_key": "jobs",
            "keywords": ["policy", "civic", "arts", "media", "public service"],
            "location": "NYC or remote",
            "radius_miles": 50,
        },
        "source_adapters": ["job-agents-json"],
        "schedule": "0 8 * * *",
        "status": "active",
    },
]


def templates():
    return deepcopy(TEMPLATES)


def get_template(template_id):
    for template in TEMPLATES:
        if template["id"] == template_id:
            return deepcopy(template)
    return None


def definition_for(search):
    """Return a normalized template-shaped definition for a stored search."""
    definition = {
        "id": search["id"],
        "name": search["name"],
        "kind": search["kind"],
        "profile": search.get("profile", {}),
        "source_adapters": search.get("source_adapters", []),
        "schedule": search["schedule"],
        "status": search.get("status", "active"),
    }
    return definition
