"""The grid files the site reads match pipeline.grid, and the browser fixture matches cell_for."""
from __future__ import annotations

import json

import pytest

from pipeline import export_grid
from pipeline.grid import CELLS, cell_for


def test_committed_files_are_up_to_date():
    assert export_grid.GRID_PATH.read_text(encoding="utf-8") == export_grid._dump(export_grid.grid_doc())
    assert export_grid.FIXTURE_PATH.read_text(encoding="utf-8") == export_grid._dump(export_grid.fixture_doc())


def test_grid_json_has_every_cell_with_its_bounds():
    doc = json.loads(export_grid.GRID_PATH.read_text(encoding="utf-8"))
    assert [c["id"] for c in doc["cells"]] == [c["id"] for c in CELLS]
    west = next(c for c in doc["cells"] if c["id"] == "west-tehran")
    assert (west["lat_min"], west["lat_max"], west["lon_min"], west["lon_max"]) == (35.4, 35.8, 51.0, 51.4)


def test_fixture_covers_edges_places_and_the_outside():
    doc = json.loads(export_grid.FIXTURE_PATH.read_text(encoding="utf-8"))
    pts = doc["points"]
    assert any(p["cell"] is None for p in pts)
    assert {p["cell"] for p in pts if p["cell"]} == {c["id"] for c in CELLS}
    for p in pts:
        expected = cell_for(p["lat"], p["lon"])
        assert p["cell"] == (expected["id"] if expected else None)


def test_places_are_assigned_by_computation():
    places = json.loads(export_grid.PLACES_PATH.read_text(encoding="utf-8"))["places"]
    where = {p["id"]: cell_for(p["lat"], p["lon"])["id"] for p in places}
    assert where["azadi"] == "west-tehran"
    assert where["rey"] == "east-tehran"          # Shahr-e Rey is east of 51.4, so it is East Tehran
    assert where["karaj"] == "northwest-alborz"
    assert where["varamin"] == "southeast-plain"


def test_check_flag_reports_drift(tmp_path, monkeypatch):
    monkeypatch.setattr(export_grid, "GRID_PATH", tmp_path / "grid.json")
    monkeypatch.setattr(export_grid, "FIXTURE_PATH", tmp_path / "fixture.json")
    assert export_grid.main(["--check"]) == 1          # nothing written yet
    assert export_grid.main([]) == 0
    assert export_grid.main(["--check"]) == 0
    (tmp_path / "grid.json").write_text("{}", encoding="utf-8")
    assert export_grid.main(["--check"]) == 1
