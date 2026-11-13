"""Tehran's 377 neighbourhoods by CAMS square: the committed web/src/forecast/city.json.

These tests read the committed file only; shapely (needed to build it, see requirements-geo.txt)
is never imported here.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from pipeline import export_city
from pipeline.grid import CELLS

ROOT = Path(__file__).resolve().parent.parent
CITY = ROOT / "web" / "src" / "forecast" / "city.json"


@pytest.fixture(scope="module")
def city():
    return json.loads(CITY.read_text(encoding="utf-8"))


def test_city_has_the_draft_keys(city):
    assert list(city) == ["cells", "places", "outline", "hoods", "groups"]
    assert [c["id"] for c in city["cells"]] == [c["id"] for c in CELLS]
    assert all(set(c) == {"id", "name", "box"} for c in city["cells"])   # no days: forecasts come at run time
    for c, g in zip(city["cells"], CELLS):
        assert c["box"] == [g["lon_min"], g["lat_min"], g["lon_max"], g["lat_max"]]
    assert len(city["places"]) == 7
    assert all(set(p) == {"id", "name", "lat", "lon"} for p in city["places"])
    assert len(city["outline"]) == 99
    assert all(set(h) == {"n", "c", "s", "g"} for h in city["hoods"])


def test_city_hood_counts(city):
    assert len(city["hoods"]) == 377
    counts = Counter(h["c"] for h in city["hoods"])
    assert dict(counts) == {"west-tehran": 174, "east-tehran": 185, "northeast-tehran": 17, "north-tehran": 1}


def test_city_main_share_at_least_0_43(city):
    assert min(h["s"] for h in city["hoods"]) >= 0.43
    assert all(h["s"] <= 1 for h in city["hoods"])


def test_city_rings_have_four_decimals(city):
    for h in city["hoods"]:
        for ring in h["g"]:
            for x, y in ring:
                assert x == round(x, 4) and y == round(y, 4)


def test_city_groups_are_four_closed_outlines(city):
    groups = city["groups"]
    assert len(groups) == 4
    assert {g["c"] for g in groups} == {"west-tehran", "east-tehran", "northeast-tehran", "north-tehran"}
    for g in groups:
        assert g["rings"]
        for ring in g["rings"]:
            assert len(ring) >= 4 and ring[0] == ring[-1]


def test_export_city_clips_a_square_exactly():
    # the share arithmetic is plain Python: a unit square cut in half by a box edge
    ring = [[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]
    whole = export_city.area(export_city.clip(ring, 0, 0, 2, 1))
    half = export_city.area(export_city.clip(ring, 0, 0, 1, 1))
    assert half == pytest.approx(whole / 2)
