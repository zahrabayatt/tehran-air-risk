"""Writes the grid files the site reads, so the TypeScript never copies a grid edge by hand.

    python -m pipeline.export_grid          # rewrite both files
    python -m pipeline.export_grid --check  # exit 1 if either file is out of date

- web/public/data/grid.json         every cell of pipeline.grid.CELLS: id, name, row, col, centre and bounds.
                                    The browser finds a place's cell from these bounds with the same
                                    half-open rule as `cell_for` (lat_min <= lat < lat_max, lon_min <= lon < lon_max).
- web/src/forecast/cellFixture.json points with the cell `cell_for` returns for each (or null), used by a
                                    unit test to prove the browser rule gives the same answers: cell centres,
                                    every grid edge and corner with tiny nudges either side, the named places
                                    in web/src/forecast/places.json, and points outside the grid.

Both files are committed (the deploy job has no Python), and tests/test_export_grid.py fails if they drift.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from pipeline.grid import CELLS, LAT_EDGES, LON_EDGES, cell_for

ROOT = Path(__file__).resolve().parent.parent
GRID_PATH = ROOT / "web" / "public" / "data" / "grid.json"
FIXTURE_PATH = ROOT / "web" / "src" / "forecast" / "cellFixture.json"
PLACES_PATH = ROOT / "web" / "src" / "forecast" / "places.json"

CELL_FIELDS = ("id", "name", "row", "col", "lat", "lon", "lat_min", "lat_max", "lon_min", "lon_max")
# Nudges around a grid line: 1e-5 is a real step to either side; 1e-7 is absorbed by cell_for's rounding
# to 6 decimals, so the point lands on the line itself.
NUDGES = ((-1e-5, -1e-5), (1e-5, 1e-5), (-1e-7, -1e-7), (1e-7, 1e-7))
OUTSIDE = ((0.0, 0.0), (40.0, 51.4), (35.7, 45.0), (30.0, 60.0), (35.7, 56.0), (36.2, 51.4), (35.4, 52.2))


def grid_doc() -> dict:
    return {"cells": [{k: c[k] for k in CELL_FIELDS} for c in CELLS]}


def _expected(lat: float, lon: float) -> str | None:
    cell = cell_for(lat, lon)
    return cell["id"] if cell else None


def fixture_doc() -> dict:
    points: list[tuple[float, float, str]] = []
    for c in CELLS:
        points.append((c["lat"], c["lon"], "centre of " + c["id"]))
    for lat in LAT_EDGES:
        for lon in LON_EDGES:
            points.append((lat, lon, "grid corner"))
            for dlat, dlon in NUDGES:
                points.append((lat + dlat, lon + dlon, f"grid corner {dlat:+.0e}"))
    # A point just either side of an edge in only one direction, in the middle of the other axis.
    for lat in LAT_EDGES:
        for d in (-1e-5, 1e-5):
            points.append((lat + d, 51.4 + 0.2, "lat edge"))
    for lon in LON_EDGES:
        for d in (-1e-5, 1e-5):
            points.append((35.6 + 0.0, lon + d, "lon edge"))
    for p in json.loads(PLACES_PATH.read_text(encoding="utf-8"))["places"]:
        points.append((p["lat"], p["lon"], "place " + p["id"]))
    for lat, lon in OUTSIDE:
        points.append((lat, lon, "outside"))
    return {"points": [{"lat": lat, "lon": lon, "what": what, "cell": _expected(lat, lon)} for lat, lon, what in points]}


def _shown(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def _dump(doc: dict) -> str:
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    check = "--check" in (sys.argv[1:] if argv is None else argv)
    status = 0
    for path, doc in ((GRID_PATH, grid_doc()), (FIXTURE_PATH, fixture_doc())):
        text = _dump(doc)
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                print(f"{_shown(path)} is out of date; run python -m pipeline.export_grid")
                status = 1
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8", newline="\n")
            print(f"wrote {_shown(path)}")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
