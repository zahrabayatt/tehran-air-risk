"""Grid tests: 12 unique CAMS cells and the lookup from a coordinate to its cell."""
from __future__ import annotations

import pytest

from pipeline.grid import CELLS, cell_for


def test_twelve_unique_cells():
    assert len(CELLS) == 12
    assert len({c["id"] for c in CELLS}) == 12
    assert len({(c["lat"], c["lon"]) for c in CELLS}) == 12
    assert len({(c["row"], c["col"]) for c in CELLS}) == 12
    assert len({c["name"] for c in CELLS}) == 12


def test_cells_have_required_fields():
    for c in CELLS:
        assert set(c) >= {"id", "lat", "lon", "row", "col", "name"}


def test_west_tehran():
    assert cell_for(35.70, 51.34)["name"] == "West Tehran"


def test_east_tehran():
    assert cell_for(35.74, 51.54)["name"] == "East Tehran"


def test_west_and_east_differ():
    assert cell_for(35.70, 51.34)["id"] != cell_for(35.74, 51.54)["id"]


@pytest.mark.parametrize("lat, lon", [(0.0, 0.0), (40.0, 51.4), (35.7, 45.0), (30.0, 60.0), (35.7, 56.0)])
def test_outside_grid_returns_none(lat, lon):
    assert cell_for(lat, lon) is None


def test_every_cell_centre_maps_to_itself():
    for c in CELLS:
        assert cell_for(c["lat"], c["lon"]) == c


def test_cell_centre_lookup_is_consistent_inside_a_cell():
    # Two points a few km apart in the same cell share one forecast.
    assert cell_for(35.69, 51.30)["id"] == cell_for(35.74, 51.38)["id"]


def test_probe_finding_35_5_and_35_7_share_a_cell():
    assert cell_for(35.5, 51.3)["id"] == cell_for(35.7, 51.3)["id"]


def test_boundaries_are_half_open_on_multiples_of_0_4():
    # Verified by the dense probe: a point exactly on an edge belongs to the cell
    # above (north) or to the east of it.
    assert cell_for(35.4, 51.0)["name"] == "West Tehran"
    assert cell_for(35.3999, 51.0)["row"] == 2
    assert cell_for(35.4, 50.9999)["col"] == 0
    assert cell_for(35.8, 51.4)["row"] == 0
    assert cell_for(35.6, 51.4)["name"] == "East Tehran"
    assert cell_for(35.6, 51.3999)["name"] == "West Tehran"


def test_grid_extent_is_exclusive_at_the_north_and_east_edges():
    assert cell_for(36.2, 51.2) is None
    assert cell_for(35.6, 52.2) is None
    assert cell_for(35.0, 50.6) is not None
    assert cell_for(34.9999, 51.2) is None


def test_centres_are_multiples_of_0_4_degrees():
    for c in CELLS:
        assert round(c["lat"] / 0.4, 6) % 1 == 0
        assert round(c["lon"] / 0.4, 6) % 1 == 0
