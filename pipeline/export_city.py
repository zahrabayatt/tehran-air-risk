"""One-off export: Tehran's 377 OSM neighbourhoods, each given the CAMS square that holds most of it.

    pip install -r requirements-geo.txt        # shapely, for the outlines only
    python -m pipeline.export_city

Writes web/src/forecast/city.json (committed; the site and the tests read that file, so neither
needs shapely). Inputs are in data/osm/: the neighbourhood polygons and the city outline with the
seven named places (OpenStreetMap, (c) OpenStreetMap contributors, ODbL).

1. Shares. Each polygon ring is clipped to each square (Sutherland-Hodgman against an axis-aligned
   box) and measured with the shoelace formula, in degrees with longitude scaled by cos(35.7) so
   east-west and north-south count alike. Holes are subtracted. The neighbourhood takes the square
   with the largest area (`c`); `s` is that square's share of the neighbourhood. Rings are rounded
   to 4 decimals (about 10 m) for drawing.
2. Group outlines. Neighbouring OSM shapes do not always share points exactly, which leaves gaps in
   a seam drawn from shared edges. Each neighbourhood is grown by about 30 m, each square's group is
   merged, and the result is shrunk back by the same amount and lightly simplified: small gaps
   close and the outline stays where it was. Needs shapely (imported only for this step).
"""
from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

from pipeline.grid import CELLS

ROOT = Path(__file__).resolve().parent.parent
OSM_DIR = ROOT / "data" / "osm"
NEIGHBOURHOODS = OSM_DIR / "tehran_neighborhoods.geojson"
OUTLINE = OSM_DIR / "tehran_outline.json"
OUT = ROOT / "web" / "src" / "forecast" / "city.json"
K = math.cos(math.radians(35.7))
GAP = 0.0003            # degrees, about 30 m
SIMPLIFY = 0.0002       # degrees, about 20 m


def clip(ring, w, s, e, n):
    """The ring clipped to the box [w, e] x [s, n], as a list of points (empty if nothing is left)."""
    def edge(pts, inside, cross):
        out = []
        for i, cur in enumerate(pts):
            prev = pts[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cross(prev, cur))
        return out

    def at_x(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))

    def at_y(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)

    pts = [tuple(p) for p in ring[:-1]] if ring[0] == ring[-1] else [tuple(p) for p in ring]
    for inside, cross in ((lambda p: p[0] >= w, at_x(w)), (lambda p: p[0] <= e, at_x(e)),
                          (lambda p: p[1] >= s, at_y(s)), (lambda p: p[1] <= n, at_y(n))):
        pts = edge(pts, inside, cross)
        if not pts:
            return []
    return pts


def area(pts):
    """Shoelace area, with longitude scaled by cos(35.7)."""
    return abs(sum(a[0] * K * b[1] - b[0] * K * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))) / 2


def polygons(geom):
    return geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]


def _boxes():
    return [{"id": c["id"], "name": c["name"], "box": [c["lon_min"], c["lat_min"], c["lon_max"], c["lat_max"]]}
            for c in CELLS]


def assign_hoods(features, cells) -> list[dict]:
    """One entry per neighbourhood that touches a square: name `n`, square `c`, main share `s`, rings `g`."""
    out = []
    for f in features:
        shares = {}
        for c in cells:
            w, s, e, n = c["box"]
            a = 0.0
            for poly in polygons(f["geometry"]):
                a += area(clip(poly[0], w, s, e, n))
                for hole in poly[1:]:
                    a -= area(clip(hole, w, s, e, n))
            if a > 0:
                shares[c["id"]] = a
        if not shares:
            continue
        total = sum(shares.values())
        cell, best = max(shares.items(), key=lambda kv: kv[1])
        rings = [[[round(x, 4), round(y, 4)] for x, y in poly[0]] for poly in polygons(f["geometry"])]
        out.append({"n": f["properties"].get("name", ""), "c": cell, "s": round(best / total, 3), "g": rings})
    return out


def group_outlines(hoods) -> list[dict]:
    """Each square's neighbourhoods merged into closed outlines (30 m gap closing). Needs shapely."""
    from shapely.geometry import MultiPolygon, Polygon
    from shapely.ops import unary_union

    groups = {}
    for h in hoods:
        for ring in h["g"]:
            if len(ring) >= 4:
                groups.setdefault(h["c"], []).append(Polygon(ring).buffer(0))
    out = []
    for cell, polys in groups.items():
        shape = unary_union([p.buffer(GAP) for p in polys]).buffer(-GAP).simplify(SIMPLIFY)
        parts = shape.geoms if isinstance(shape, MultiPolygon) else [shape]
        rings = [[[round(x, 4), round(y, 4)] for x, y in p.exterior.coords] for p in parts if p.area > 1e-6]
        out.append({"c": cell, "rings": rings})
    return out


def build() -> dict:
    features = json.loads(NEIGHBOURHOODS.read_text(encoding="utf-8"))["features"]
    seed = json.loads(OUTLINE.read_text(encoding="utf-8"))
    cells = _boxes()
    hoods = assign_hoods(features, cells)
    return {"cells": cells, "places": seed["places"], "outline": seed["outline"],
            "hoods": hoods, "groups": group_outlines(hoods)}


def main() -> int:
    city = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(city, separators=(",", ":"), ensure_ascii=False) + "\n",
                   encoding="utf-8", newline="\n")
    hoods = city["hoods"]
    print(len(hoods), "neighbourhoods; smallest main share", min(h["s"] for h in hoods))
    print(dict(Counter(h["c"] for h in hoods)))
    print("groups:", {g["c"]: len(g["rings"]) for g in city["groups"]}, "size", OUT.stat().st_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
