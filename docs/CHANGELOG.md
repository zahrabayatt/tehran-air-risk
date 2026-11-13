# Changelog

All notable changes to this project. Dates are real dates, from the commit history.

## 2.0.0 - 2026-11-13

Model version 2: tomorrow's weather.

### Added

- Five inputs from the ECMWF IFS 00 UTC weather forecast of the issue day, for the hours of the target day: mean temperature, mean humidity, mean wind speed, total precipitation and mean boundary layer height (Open-Meteo Single Runs API, runs from 2024-03-14).
- Four feature sets (`pm_season`, `all`, `pm_season_wx`, `all_wx`) with five penalty strengths each, 20 candidates trained on the same 11,544 rows that have a weather forecast. Chosen by selection cost: `all_wx` with penalty 10 (selection cost 0.0869).
- Held-out cost 0.1251, against 0.3086 for the overall rate and 0.3155 for each month's rate; scikit-learn gives the same fit. This is a second look at the held-out year, which was already used for version 1.
- `model/model.json` is version 2 and keeps version 1's numbers under `previous`. Every candidate now stores its weights and bias.

### Changed

- The daily workflow now tries four times a day (10:30, 12:30, 14:30 and 16:30 UTC) and saves a square's forecast only when both the CAMS pollutants and tomorrow's ECMWF weather are ready. A saved forecast is never overwritten, a forecast saved after Tehran midnight carries `issued_late`, and each entry stores the weather inputs it used. Exit status 4 means some squares are waiting for the next try. `python -m pipeline.predict --dry-run` prints entries without writing.
- The training rows now start on 2024-03-15 (4,968 training, 2,208 selection, 4,368 held-out rows).

## 1.0.1 - 2026-11-04

Changes from the final review.

### Changed

- The daily workflow now runs at 13:30 UTC (17:00 Tehran) instead of 10:00 UTC. Live inputs matched the stored history when fetched at 13:30 to 13:36 UTC, and Open-Meteo's metadata shows the 00 UTC CAMS run is available about 9.7 hours after it starts (see "Live vs history" in `docs/DATA_PROFILE.md`). The Lab reads the time from one constant, `DAILY_RUN_UTC` in `web/src/config.ts`.
- The daily run is bounded: one request attempt is cut off after 45 seconds, fetching stops after a time budget (600 s for forecasts, 300 s for outcomes), the workflow has no shell retry loop, each step has a timeout and does not stop the commit step, and the commit step runs even if a step was cut off, so gaps are always committed. The workflow runs only from `main`, and the `pages.yml` build job no longer receives an identity-token permission.
- Outcomes still missing 14 days after their target day are no longer retried; they stay empty and carry an `outcome_note`.
- The forecast log says forecasts are "usually" saved before the day begins and marks any saved after it began. The Forecast page says when the forecast's day has ended in Tehran.
- Model Lab wording: no air-quality category names (the label is "above 35.4 μg/m³"), the season axis is described in plain words before sine and cosine are taught, the scaling step describes what its demo shows, and the held-out step states the limit of the selection months.
- Weather credit: ECMWF is credited beside Open-Meteo for the IFS weather values.
- Docs: tracker code references, scope-test description and the 44 by 36 km wording corrected.

## 1.0.0 - 2026-11-04

First complete version.

### Added

- Source checks: the grid of 12 cells found by probing the API, the label threshold confirmed against the EPA breakpoint table, and whether tomorrow's weather forecast can be reproduced as issued (it cannot, so only today's weather is a candidate input). Recorded in `docs/DATA_PROFILE.md`.
- History fetching for the 12 cells (2022-08-04 to 2026-11-02) and daily labels: Tehran calendar day, mean PM2.5 above 35.4 μg/m³, at least 20 of 24 hourly values.
- Features built only from the 12 hours before the 12:00 Tehran cutoff, with leakage tests, and a time split into training, selection and held-out parts.
- Logistic regression trained with this project's own gradient descent: sigmoid, logistic cost, a penalty on the weights, z-score scaling. Ten candidates were compared on the selection months; the final twelve months were held out and looked at once. Held-out cost 0.1515, against 0.3077 for the overall rate and 0.2950 for each month's rate; scikit-learn gives the same fit.
- Daily forecast pipeline: a scheduled run at 10:00 UTC fetches all squares, applies the frozen model, records gaps instead of inventing values, fills in outcomes for finished days, commits `data/predictions.json` and deploys the site.
- Forecast page: a map of 12 squares of about 44 by 36 km with the city outline, a place selector, the model layer and a CAMS layer for comparison, a headline with the last-updated time, a 14-day log beside outcomes, and stale, empty and error states.
- Model Lab: 17 guided steps from classification to the daily forecast, with live plots, run controls, math, line-by-line project code and scikit-learn equivalents. Experiments run in the browser and cannot change the live model.
- Data page: source, licences, period and resolution, how days are split, the counts from labelled days to model rows, data quality, positive rates by year, month and square, fields, and limitations.
- Checks: Python tests, TypeScript tests, browser tests, an accessibility check (axe) on every route in both themes at desktop and phone widths with no sideways scroll at 390 pixels, and a scope check for out-of-scope metric names.
- Continuous integration on push and pull request, and a GitHub Pages deploy that waits for CI on `main`. The daily workflow and the push deploy share one Pages concurrency group so two deploys never overlap.
- Documentation: README, project spec, learning notes, data card, data profile, progress tracker.

### Fixed

- Labels are stored as 64-bit integers (2026-11-03).
- Rows on Iran's summer time are dropped, and scaling is hardened against columns with no spread (2026-11-03).
- The daily workflow's build job gets the permission `actions/configure-pages` needs (2026-11-03).
- Forecast page review findings (2026-11-03) and Model Lab review findings (2026-11-04); the Lab's overflow stop no longer depends on the penalty term (2026-11-04).

## Development log

| Date | Change |
|---|---|
| 2026-11-03 | Repository started; sources verified; grid profile wording corrected |
| 2026-11-03 | History fetching and labels; features with leakage tests |
| 2026-11-03 | Logistic model and baselines trained; summer-time rows dropped |
| 2026-11-03 | Daily forecast pipeline; Pages permission fix |
| 2026-11-03 | Web foundation, Forecast page and its review fixes |
| 2026-11-03 | Lab teaching code, fixtures and the Model Lab |
| 2026-11-04 | Lab review fixes; Data page, checks and docs |
