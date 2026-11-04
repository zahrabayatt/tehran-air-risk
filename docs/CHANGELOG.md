# Changelog

All notable changes to this project. Dates are real dates, from the commit history.

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
