# Data profile

Every number here is measured by `training/verify_sources.py` from live API responses (cached in `data/raw/`, git-ignored) except where marked as a documentation claim. Re-run `python training/verify_sources.py all`, then `python training/verify_sources.py profile` to regenerate this file. Verification ran on 2026-11-03.

## Sources and terms

| Use | Source | License / terms |
|---|---|---|
| Pollutants (PM2.5, PM10, NO2, SO2, CO, O3), hourly | Open-Meteo Air Quality API, CAMS global domain (`domains=cams_global`; the default `auto` returned identical values for Tehran) | CC-BY 4.0; attribute CAMS (Copernicus Atmosphere Monitoring Service) and Open-Meteo |
| Weather inputs | Open-Meteo Historical Forecast API (`models=ecmwf_ifs`), see Weather below | CC-BY 4.0; attribute Open-Meteo |
| Label threshold | U.S. EPA PM2.5 24-hour AQI breakpoint | U.S. government work |

Values are model-derived (CAMS fields), not station measurements. The Open-Meteo free tier is for non-commercial use and limited to 10,000 weighted calls per day (600 per minute). This verification used about 2,250 weighted calls (grid probe 616, counted by the script; history estimated as 12 locations x 1,556 days / 14; weather about 300 single-location requests). It hit the per-minute limit and, after some oversized requests, a 'too many concurrent requests' refusal that lasted about 25 minutes on the weather hosts; the script waits 65 s on a 429 and retries.

## Grid

Dense probe: 2,565 points every 0.05 degrees over latitude 34.6 to 36.8 and longitude 50.2 to 53.0, hourly `pm2_5` for 2026-10-20 to 2026-10-26 (7 days x 24 values per point). Two points are in the same cell when their series are identical.

- **The API's returned coordinates do not identify the cell.** Requesting (35.5, 51.3) and (35.7, 51.3) returned latitude/longitude 35.5, 51.300003 and 35.700005, 51.300003: the request echoed back. Identical series for those two points show they share a cell (True). Cells were found by comparing series, not coordinates.
- The probe area holds **48 distinct cells**, all rectangles, none empty. 35 of them contain 8 x 8 = 64 probe points (including each of the 12 grid cells below: 64 points each); the other 13 are partial cells on the edge of the probe area, with 5, 8, 8, 8, 8, 8, 40, 40, 40, 40, 40, 40, 40 points. The 2,565 probe points are the sum over all 48 cells.
- Edges refined to 0.005 degrees (each value is the midpoint of the last pair of points whose series differ). Latitude: 34.9975, 35.3975, 35.7975, 36.1975, 36.5975. Longitude: 50.5975, 50.9975, 51.3975, 51.7975, 52.1975, 52.5975, 52.9975. Each value sits 0.0025 below 35.0, 35.4, 35.8, 36.2 (latitude) or 50.6, 51.0, 51.4, 51.8, 52.2 (longitude): the last point of the lower or western cell is 0.005 below the edge and the first point of the upper or eastern cell is exactly on it. So a point on an edge belongs to the cell to its north or east, and cells are half-open boxes.
- Cell centres are multiples of 0.4 degrees (the model grid points); edges lie halfway between them. The earlier guess (centres 35.2, 35.6, 36.0 and 50.8, 51.2, 51.6, 52.0; 35.5 and 35.7 in one cell) is confirmed.
- Size: 0.4 degrees is 44.5 km north-south but only about 36 km east-west at 35.6 N (0.4 x 111.32 x cos 35.6). "About 45 km" is true for height only; the site text should say about 44 by 36 km.

| id | Name | Row (0 = north) | Col (0 = west) | Centre (lat, lon) | Latitude [min, max) | Longitude [min, max) |
|---|---|---|---|---|---|---|
| northwest-alborz | Northwest Alborz | 0 | 0 | 36.0, 50.8 | 35.8 to 36.2 | 50.6 to 51.0 |
| north-tehran | North Tehran | 0 | 1 | 36.0, 51.2 | 35.8 to 36.2 | 51.0 to 51.4 |
| northeast-tehran | Northeast Tehran | 0 | 2 | 36.0, 51.6 | 35.8 to 36.2 | 51.4 to 51.8 |
| far-northeast | Far Northeast | 0 | 3 | 36.0, 52.0 | 35.8 to 36.2 | 51.8 to 52.2 |
| far-west | Far West | 1 | 0 | 35.6, 50.8 | 35.4 to 35.8 | 50.6 to 51.0 |
| west-tehran | West Tehran | 1 | 1 | 35.6, 51.2 | 35.4 to 35.8 | 51.0 to 51.4 |
| east-tehran | East Tehran | 1 | 2 | 35.6, 51.6 | 35.4 to 35.8 | 51.4 to 51.8 |
| far-east | Far East | 1 | 3 | 35.6, 52.0 | 35.4 to 35.8 | 51.8 to 52.2 |
| southwest-plain | Southwest Plain | 2 | 0 | 35.2, 50.8 | 35.0 to 35.4 | 50.6 to 51.0 |
| south-central | South Central | 2 | 1 | 35.2, 51.2 | 35.0 to 35.4 | 51.0 to 51.4 |
| southeast-plain | Southeast Plain | 2 | 2 | 35.2, 51.6 | 35.0 to 35.4 | 51.4 to 51.8 |
| far-southeast | Far Southeast | 2 | 3 | 35.2, 52.0 | 35.0 to 35.4 | 51.8 to 52.2 |

Names are compass labels for the approximate position of each square, not administrative areas. `cell_for(35.70, 51.34)` is West Tehran and `cell_for(35.74, 51.54)` is East Tehran. The city centre (about 35.69, 51.39) is about 0.01 degrees from the West/East edge at longitude 51.4, so the two central squares split Tehran along that line.

## History

Hourly data requested from 2022-07-01 to 2026-11-02 (the last complete Tehran day before verification), one request per calendar year for all 12 cell centres.

| Cell | First non-null hour | First usable day (>= 20 h) | Usable days | Excluded days after start | PM2.5 null share after start | Positive rate (> 35.4) | Mean PM2.5, ug/m3 | Days with mean in (35.4, 35.5) |
|---|---|---|---|---|---|---|---|---|
| Northwest Alborz | 2022-08-04 03:00:00 | 2022-08-04 | 1,552 | 0 | 0.008% | 1.7% | 17.35 | 1 |
| North Tehran | 2022-08-04 03:00:00 | 2022-08-04 | 1,552 | 0 | 0.008% | 1.4% | 15.62 | 0 |
| Northeast Tehran | 2022-08-04 03:00:00 | 2022-08-04 | 1,552 | 0 | 0.008% | 0.8% | 13.61 | 0 |
| Far Northeast | 2022-08-04 03:00:00 | 2022-08-04 | 1,552 | 0 | 0.008% | 0.4% | 11.61 | 0 |
| Far West | 2022-08-04 03:00:00 | 2022-08-04 | 1,552 | 0 | 0.008% | 13.0% | 22.26 | 1 |
| West Tehran | 2022-08-04 03:00:00 | 2022-08-04 | 1,552 | 0 | 0.008% | 46.1% | 38.49 | 3 |
| East Tehran | 2022-08-04 03:00:00 | 2022-08-04 | 1,552 | 0 | 0.008% | 13.9% | 25.36 | 4 |
| Far East | 2022-08-04 03:00:00 | 2022-08-04 | 1,552 | 0 | 0.008% | 0.2% | 14.58 | 0 |
| Southwest Plain | 2022-08-04 03:00:00 | 2022-08-04 | 1,552 | 0 | 0.008% | 1.4% | 16.86 | 0 |
| South Central | 2022-08-04 03:00:00 | 2022-08-04 | 1,552 | 0 | 0.008% | 3.2% | 19.65 | 0 |
| Southeast Plain | 2022-08-04 03:00:00 | 2022-08-04 | 1,552 | 0 | 0.008% | 1.4% | 17.56 | 0 |
| Far Southeast | 2022-08-04 03:00:00 | 2022-08-04 | 1,552 | 0 | 0.008% | 0.4% | 14.96 | 0 |

- All cells start together: first usable day 2022-08-04. Hours before 03:00 that day are null (the series begins at 2022-08-04 00:00 UTC), leaving 21 of 24 hours, still labelled. The design spec's 2022-08-05 is conservative by one partial day.
- After the start no day is excluded for missing hours. The only nulls are the first 3 hours (null share 0.0080% for each of PM2.5, PM10, NO2, SO2, CO and O3 in every cell). History has no gaps today; the 20-of-24 rule matters only if a later fetch returns nulls.
- Pooled over the 12 cells: 18,624 labelled cell-days, positive rate **7.0%**.
- **The spec's 46.1% positive rate is the West Tehran cell alone (46.1%), not the pooled grid.** Rates by cell run from 0.2% to 46.1%; only West Tehran, East Tehran and Far West exceed 10%. A pooled model sees heavy class imbalance and strong cell differences. The baselines, model card, and site text must use the pooled figure.
- Pooled positive rate by year (cell-days in brackets): 2022: 5.1% (1,800); 2023: 6.5% (4,380); 2024: 6.2% (4,392); 2025: 9.3% (4,380); 2026: 6.8% (3,672). 2022 starts in August and 2026 ends in early November.
- The latest hours (2026-11-02 evening) are present. For the most recent days the values come from CAMS forecast runs rather than a later analysis, so live inputs may differ slightly from the stored history. Disclose this limitation.

### Time labelling (matters for the cutoff)

- With `timezone=Asia/Tehran` the response reports `utc_offset_seconds = 12600` (+03:30) for the whole range, with no daylight-saving shift, and every day has exactly 24 values. Labels are whole hours: the value labelled `00:00` is the UTC 21:00 value (checked on 2026-10-25: the `GMT` and `Asia/Tehran` series differ by exactly a 3-hour shift). A labelled day is the 24 instants whose true local time (+03:30) is 00:30 to 23:30, so day boundaries are right for a daily mean.
- **Cutoff rule for features:** 12:00 Tehran is 08:30 UTC. The last CAMS hour not after the cutoff is 08:00 UTC, labelled `11:00` in Asia/Tehran time. Use labelled hours `00:00` to `11:00` (12 values) as same-day inputs. The value labelled `12:00` is 09:00 UTC, 30 minutes after the cutoff.
- Iran used +04:30 in summer until September 2022; the API labels the whole history with +03:30, so history is internally consistent.

## Label threshold: EPA breakpoint

- Source: U.S. EPA, Reconsideration of the National Ambient Air Quality Standards for Particulate Matter, final rule, 89 FR 16202 (March 6, 2024), FR Doc 2024-02637, Appendix G to 40 CFR Part 58. URL: <https://www.govinfo.gov/content/pkg/FR-2024-03-06/html/2024-02637.htm>. Effective May 6, 2024.
- The Appendix G PM2.5 24-hour table reads: Good 0-50 for 0.0-9.0 ug/m3; Moderate 51-100 for 9.1-35.4; Unhealthy for Sensitive Groups 101-150 for 35.5-55.4; Unhealthy 151-200 for 55.5-125.4. The rule text says the EPA is retaining the AQI values of 100 and 150 at 35.4 and 55.4 ug/m3. **The 2024 revision changed the Good/Moderate break (to 9.0) and the breakpoints from 200 up, not 35.4.**
- **Confirmed: 35.4 ug/m3 is the top of Moderate and 35.5 begins Unhealthy for Sensitive Groups.**
- Truncation: Appendix G truncates PM2.5 to one decimal place before lookup (text found). A mean of 35.46 is therefore 35.4 (Moderate) for the EPA, while the project label `mean > 35.4` marks it positive. This affects 9 of 18,624 cell-days. The project keeps `mean > 35.4` as specified; the site should say "above 35.4" and not claim to reproduce an EPA category.
- The EPA defines the AQI for 24-hour averages of monitor data. Applying it to CAMS cell means is a labelling convention, not an EPA classification.

## Weather: can tomorrow's forecast, as issued, be reproduced?

Point 35.7, 51.34 (West Tehran); model `ecmwf_ifs` (ECMWF IFS HRES 9 km); variables temperature_2m, relative_humidity_2m, wind_speed_10m, precipitation, boundary_layer_height. Cutoff 12:00 Tehran = 08:30 UTC; the daily tries start at 10:30 UTC. Coverage was probed at this one point and is assumed the same at the other 11 cell centres.

- The 00 UTC IFS run became available 6.8 h after initialisation (one observation of Open-Meteo's run metadata: initialised 2026-11-03T00:00:00, available 2026-11-03T06:47:54). At 08:30 UTC only the 00 UTC run of the same day is in hand; the 06 UTC run arrives near 13:00 UTC. A forecast "as issued before the cutoff" for tomorrow is the 00 UTC run of today, at lead times of about 21 to 44 hours.

Archive coverage, 3-day samples at quarter starts from 2021-01-05 to 2026-10-05 (a sample is populated when it has no nulls):

| Variable | Historical Forecast API: first populated sample | Previous Runs API `_previous_day1`: first populated sample |
|---|---|---|
| temperature_2m | 2021-01-05 (24 of 24 samples populated) | 2025-10-05 (4 of 24 samples populated) |
| relative_humidity_2m | 2021-01-05 (24 of 24 samples populated) | 2025-10-05 (4 of 24 samples populated) |
| wind_speed_10m | 2021-01-05 (24 of 24 samples populated) | 2025-10-05 (5 of 24 samples populated) |
| precipitation | 2021-01-05 (24 of 24 samples populated) | 2025-10-05 (5 of 24 samples populated) |
| boundary_layer_height | 2024-10-05 (8 of 24 samples populated) | never (0 of 24 samples populated) |

- Historical Forecast: temperature, humidity, wind and precipitation are populated in every sample back to 2021-01-05 (the earliest probed; the documentation says 2017 for this model). Boundary layer height begins on **2024-09-01** and is missing 24% of the hours in October 2025 at the sampled point.
- Previous Runs with `ecmwf_ifs`: first populated day **2025-10-01**, uneven afterwards (several 2026 samples lack temperature and humidity, or wind and precipitation), and boundary layer height is never populated. With the default model (`best_match`) the four weather variables are populated from the 2024-04-05 sample, but boundary layer height never is, and `best_match` is a blend whose members change over time. Not usable for a fixed run.
- Single Runs API (`ecmwf_ifs`): populated for runs 2024-03-14T00:00, 2024-03-15T00:00, 2025-01-15T00:00, 2026-04-01T00:00, 2026-10-13T00:00 (all five variables, 7-day horizon; precipitation has no value for hour 0). Refused: 2024-03-13T00:00 ("requested model run is not available"). The documentation says other models start 2026-04-02; a request for a 2025 GFS run was refused.
- The Historical Forecast API is **not an as-issued archive**. Its documentation says it joins the first hours of each model run into one timeseries, and the measurement agrees: for 3 target days its temperature series equals `previous_day0` exactly (True) and differs from each single run (mean absolute difference in degrees C, by target day: 2026-10-12: 0.208 to 0.379; 2026-10-13: 0.246 to 0.363; 2026-10-14: 0.296 to 0.483). It is the near-analysis value, not what was forecast the day before.
- `previous_day1` is a fixed 24 h lead per valid hour, so it mixes runs through the day. It matched no single run exactly (mean absolute difference 0.104 to 0.296 degrees C), and in 18 of 72 sampled hours the nearest run was initialised after the 08:30 UTC cutoff. It cannot reproduce "the run in hand at 12:00".

### Verdict

**Tomorrow's forecast as issued before the cutoff is reproducible only from 2024-03-14, only for ECMWF IFS, and only through the Single Runs API (the 00 UTC run of the day before the target, all five variables including boundary layer height). It is not reproducible from the Historical Forecast API (not as-issued) or from the Previous Runs API (wrong run mix, short and patchy archive, no boundary layer height).**

Using the Single Runs path would cut the labelled history from 1,552 days to about 960 (2024-03-14 to 2026-11-02), leaving about 14 months to train on after a 12-month held-out set and a 6-month selection set: one winter cycle. It needs one request per cell-day (about 11,500 cell-days), several days of free-tier quota, and the model changed IFS cycle on 2026-05-12 inside the held-out year (documentation claim).

**Decision, per the Task 1 rule: use today's weather only.** Same-day temperature, humidity, wind speed and precipitation (labelled hours `00:00` to `11:00`, up to the cutoff) come from the Historical Forecast API with `models=ecmwf_ifs`. They are populated since at least 2021-01-05, so the whole pollutant history is covered. They are stitched first hours of runs, the same kind of value a live call returns for past hours, so training and live inputs should match (Task 5 must confirm this against a live call). Boundary layer height exists only from 2024-09-01 with holes and is **excluded**. Tomorrow's weather is not an input: the spec's "tomorrow's forecast weather" becomes "today's weather up to the cutoff". The Single Runs path stays available as a later experiment on the shorter window.

<!-- live-vs-history:begin -->
## Live vs history

Measured on 2026-11-03T13:36:50Z by `python -m pipeline.compare_live` (all 12 cells; every number below is computed from live responses, nothing typed in). The daily pipeline fetches its inputs live; the model was trained on values fetched earlier. Differences are absolute, in the variable's own unit (ug/m3 for pollutants; degrees C, percent, km/h and mm for weather).

**What the zeros mean.** The history cache was fetched within about a day of this comparison, so a zero shows that the live sources and the cache match now. It does not show whether the hours of an issue day are revised later; the saved live snapshot (`data/raw/live_snapshot_*.csv.gz`, git-ignored) is for re-checking that on a later day.

### Weather: live forecast API against Historical Forecast API

Same 12 pre-cutoff stamps (21:00 UTC on D-1 to 08:00 UTC on D) for D = 2026-10-30, 2026-10-31, 2026-11-01, 2026-11-02, 2026-11-03; both with `models=ecmwf_ifs`, fetched in the same minute. The deployed model does not use weather (its features are `pm2_5_mean`, `pm2_5_max`, `pm2_5_last`, `season_sin`, `season_cos`), so this is informational. Historical Forecast API nulls in those hours: 0 of 2,880.

| Variable | Hours compared | Mean abs. difference | Max abs. difference | Mean level |
|---|---|---|---|---|
| temperature_2m | 720 | 0.000 | 0.000 | 11.19 |
| relative_humidity_2m | 720 | 0.000 | 0.000 | 68.69 |
| wind_speed_10m | 720 | 0.000 | 0.000 | 4.94 |
| precipitation | 720 | 0.000 | 0.000 | 0.10 |

### Pollutants: Air Quality API fetched now against the history cache

Overlap: UTC days 2026-10-27 to 2026-11-02 (the cache ends 2026-11-02 23:00:00+00:00), `domains=cams_global`, every overlapping hour.

| Variable | Hours compared | Mean abs. difference | Max abs. difference | Mean level |
|---|---|---|---|---|
| pm2_5 | 2,016 | 0.000 | 0.000 | 20.94 |
| pm10 | 2,016 | 0.000 | 0.000 | 28.17 |
| nitrogen_dioxide | 2,016 | 0.000 | 0.000 | 47.07 |
| sulphur_dioxide | 2,016 | 0.000 | 0.000 | 22.01 |
| carbon_monoxide | 2,016 | 0.000 | 0.000 | 329.02 |
| ozone | 2,016 | 0.000 | 0.000 | 53.15 |

Only the 12 pre-cutoff hours of each issue day (the hours the model sees):

| Variable | Hours compared | Mean abs. difference | Max abs. difference | Mean level |
|---|---|---|---|---|
| pm2_5 | 864 | 0.000 | 0.000 | 23.37 |
| pm10 | 864 | 0.000 | 0.000 | 29.79 |
| nitrogen_dioxide | 864 | 0.000 | 0.000 | 50.66 |
| sulphur_dioxide | 864 | 0.000 | 0.000 | 24.84 |
| carbon_monoxide | 864 | 0.000 | 0.000 | 334.43 |
| ozone | 864 | 0.000 | 0.000 | 37.89 |

PM2.5 by UTC day (newest first), to show whether older days settle:

| UTC day | Mean abs. difference | Max abs. difference |
|---|---|---|
| 2026-11-02 | 0.000 | 0.000 |
| 2026-11-01 | 0.000 | 0.000 |
| 2026-10-31 | 0.000 | 0.000 |
| 2026-10-30 | 0.000 | 0.000 |
| 2026-10-29 | 0.000 | 0.000 |
| 2026-10-28 | 0.000 | 0.000 |
| 2026-10-27 | 0.000 | 0.000 |

Weather from the Historical Forecast API fetched now against the same variables in the history cache (informational):

| Variable | Hours compared | Mean abs. difference | Max abs. difference | Mean level |
|---|---|---|---|---|
| temperature_2m | 2,016 | 0.000 | 0.000 | 12.82 |
| relative_humidity_2m | 2,016 | 0.000 | 0.000 | 55.43 |
| wind_speed_10m | 2,016 | 0.000 | 0.000 | 5.98 |
| precipitation | 2,016 | 0.000 | 0.000 | 0.06 |

### Effect on the model

For the same 72 (cell, day) pairs, probability from the cached history against probability from the fresh fetch: mean absolute difference 0.0000, maximum 0.0000, 0 change(s) of predicted class at 0.5. Feature differences (ug/m3): `pm2_5_mean` mean 0.000 / max 0.000; `pm2_5_max` mean 0.000 / max 0.000; `pm2_5_last` mean 0.000 / max 0.000.

<!-- live-vs-history:end -->

### CAMS run availability and the 13:30 UTC choice (measured 2026-11-04, one observation)

Open-Meteo publishes the state of the `cams_global` air-quality domain at `https://air-quality-api.open-meteo.com/data/cams_global/static/meta.json` (fetched 2026-11-04 about 11:35 UTC; the raw copy is `data/raw/cams_meta_2026-11-04.json`, git-ignored). The file reports only the latest run, so this is a single observation, not a distribution. It says the domain updates every 12 hours (`update_interval_seconds` 43200) and that the latest run was initialised at 2026-11-04 00:00 UTC and became available at 2026-11-04 09:43 UTC: a delay of about 9.7 hours.

The daily workflow therefore runs at 13:30 UTC (17:00 Tehran). That is about 3.8 hours after the 00 UTC run was available on the day measured, so the day's 00 UTC run is in hand with room to spare, and 13:30 to 13:36 UTC is the window in which the live inputs were compared with the history above and found identical. An earlier choice of 10:00 UTC would have left only about 17 minutes after the availability seen here, and was never compared against the history. A later or slower CAMS run than the one observed would still have to arrive more than 3.8 hours late to matter. The observation says nothing about days with a delayed run; a run whose inputs are not yet published records gaps rather than inventing values.

## Weather forecast runs

Version 2 uses tomorrow's weather as forecast, which supersedes the "today's weather only" decision above.

- **Source:** Open-Meteo Single Runs API, `https://single-runs-api.open-meteo.com/v1/forecast`, `models=ecmwf_ifs` (ECMWF IFS), `timezone=GMT`, `forecast_hours=48`, hourly `temperature_2m`, `relative_humidity_2m`, `wind_speed_10m`, `precipitation`, `boundary_layer_height`. One request per run day covers all 12 cell centres (`pipeline/weather.py`).
- **Run hour:** the 00 UTC run of the issue day D, `run=<D>T00:00`. It is the only run in hand at the 08:00 UTC cutoff.
- **Availability:** two observations of Open-Meteo's run metadata for the 00 UTC run, made on different days, so they measure different runs and both are kept. 6.8 h after 00 UTC (initialised 2026-11-03T00:00:00, available 2026-11-03T06:47:54): the first check, saved in `data/raw/verify_weather.json` and read by this generator. 6.4 h after 00 UTC (about 06:24 UTC): the check of 2026-11-12, recorded in the design notes and not saved under `data/raw`. The run is therefore published about 6.4 to 6.8 hours after 00 UTC, well before the cutoff and before the first daily try at 10:30 UTC. Two observations are not a guarantee.
- **CAMS availability, for comparison:** the 00 UTC CAMS run was available at 10:06 UTC, 10.1 hours after it starts, in Open-Meteo's run metadata checked 2026-11-12 (recorded in the design notes, not saved under `data/raw`); the check of 2026-11-04 measured 9.7 hours (`data/raw/cams_meta_2026-11-04.json`, see "CAMS run availability" above). Each is one observation. The first daily try at 10:30 UTC follows the later figure by about 24 minutes.
- **Daily tries:** 10:30, 12:30, 14:30 and 16:30 UTC. A forecast is saved only when both the CAMS and the ECMWF run are ready, and a saved forecast is never changed. A run the API does not hold yet (HTTP 400) counts as not ready, never as a gap, until the last try of the day. This replaces the single 13:30 UTC time chosen in "Live vs history" above, which was based on the CAMS run alone. A gap is recorded only by a final try (the 16:30 UTC run, or any run from 21:00 Tehran time). If that run is dropped by GitHub or cancelled (a queued run replaces an older pending one even with `cancel-in-progress: false`, so a manual dispatch can displace it), no row is written for the day: a day with no row means no forecast was recorded, and the next day's tries do not backfill it.
- **Target day:** run hours 21 to 44 (21:00 UTC on D to 20:00 UTC on D+1), 24 hours. Reductions: `wx_temp`, `wx_rh`, `wx_wind`, `wx_blh` are means, `wx_precip` is a sum. A variable with more than 4 missing hours of the 24 is missing (NaN, never filled).
- **First run:** 2024-03-14 (first target day 2024-03-15). The API refuses earlier runs ("requested model run is not available"). Training rows without all five weather inputs are dropped for every candidate alike.
- **Why Single Runs:** the Historical Forecast API is not an as-issued archive: it joins the first hours of each run into one near-analysis series, so it shows what the weather was, not what was forecast. The Previous Runs API (`previous_day1`) mixes runs through the day, has a short and patchy archive for `ecmwf_ifs` (first populated 2025-10-01) and never has boundary layer height. Only a Single Run reproduces the exact forecast that was in hand on issue day, boundary layer height included.
- **Cache:** the history build stores one JSON per run under `data/raw/weather_cache/` (git-ignored) and resumes from it; a run the API refuses is recorded as an error and listed in the build's output.

## Reproduce

```
python training/verify_sources.py all      # grid, history, weather, epa (slow: respects the rate limits)
python training/verify_sources.py profile  # regenerate this file from data/raw/verify_*.json
```

