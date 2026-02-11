import requests

def fetch_dabang_rooms(base_url: str, max_pages=30, max_items=800):
    url = f"{base_url}/api/dabang-rooms"
    resp = requests.get(url, params={"maxPages": max_pages, "maxItems": max_items}, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    items = data.get("items", [])
    return items
