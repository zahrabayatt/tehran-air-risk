"""The 12-cell CAMS grid around Tehran.

Cells are 0.4 degrees square (about 45 km north-south, about 36 km east-west at
this latitude). Boundaries come from a dense probe of the Open-Meteo Air Quality
API (docs/DATA_PROFILE.md): every point inside one cell receives the identical
series, and the change happens exactly on multiples of 0.4 degrees. A boundary
belongs to the cell above or to the east of it, so each cell is the half-open
box [lat_min, lat_max) x [lon_min, lon_max).

Row 0 is the northern band, column 0 the western one. `lat` and `lon` are the
cell centres, which are the coordinates sent to the API.
"""
from __future__ import annotations

from typing import TypedDict

CELL_SIZE = 0.4
LAT_EDGES = (35.0, 35.4, 35.8, 36.2)          # south to north
LON_EDGES = (50.6, 51.0, 51.4, 51.8, 52.2)    # west to east

# Compass labels for the approximate position of each ~45 km square.
# NAMES[row][col], row 0 = north.
NAMES = (
    ("Northwest Alborz", "North Tehran", "Northeast Tehran", "Far Northeast"),
    ("Far West", "West Tehran", "East Tehran", "Far East"),
    ("Southwest Plain", "South Central", "Southeast Plain", "Far Southeast"),
)


class Cell(TypedDict):
    id: str
    lat: float
    lon: float
    row: int
    col: int
    name: str
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float


def _slug(name: str) -> str:
    return name.lower().replace(" ", "-")


def _build() -> list[Cell]:
    cells: list[Cell] = []
    n_rows = len(LAT_EDGES) - 1
    for row in range(n_rows):
        # Row 0 is the northernmost band.
        lo, hi = LAT_EDGES[n_rows - 1 - row], LAT_EDGES[n_rows - row]
        for col in range(len(LON_EDGES) - 1):
            west, east = LON_EDGES[col], LON_EDGES[col + 1]
            name = NAMES[row][col]
            cells.append(Cell(
                id=_slug(name), lat=round((lo + hi) / 2, 6), lon=round((west + east) / 2, 6),
                row=row, col=col, name=name,
                lat_min=lo, lat_max=hi, lon_min=west, lon_max=east,
            ))
    return cells


CELLS: list[Cell] = _build()


def cell_for(lat: float, lon: float) -> Cell | None:
    """Return the cell containing (lat, lon), or None if it lies outside the grid."""
    lat, lon = round(lat, 6), round(lon, 6)  # absorb float noise at exact boundaries
    for cell in CELLS:
        if cell["lat_min"] <= lat < cell["lat_max"] and cell["lon_min"] <= lon < cell["lon_max"]:
            return cell
    return None
