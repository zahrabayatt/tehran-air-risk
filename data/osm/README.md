# OpenStreetMap data

Files here are derived from OpenStreetMap, (c) OpenStreetMap contributors, and are licensed under the
Open Database Licence (ODbL) 1.0: https://www.openstreetmap.org/copyright

- `tehran_neighborhoods.geojson`: the 377 neighbourhood polygons of Tehran, copied from the sibling
  project `tehran-house-price`. Used once, by `pipeline/export_city.py`, to give each neighbourhood the
  CAMS square that holds most of its area.
- `tehran_outline.json`: the Tehran city boundary (OSM relation 6663864) simplified to 99 points, and
  the seven named places the Forecast page offers. The same outline is drawn on the
  Forecast page, from `city.json`.

The committed result of that export is `web/src/forecast/city.json`. Rebuilding it needs
`pip install -r requirements-geo.txt`; the tests and CI read the committed file and do not.
