# Data card

The dataset behind the Tehran Air Risk model: hourly modeled air quality for twelve squares around Tehran, turned into one row per square and day. Source checks and the live-versus-history comparison are in `docs/DATA_PROFILE.md`. Every number below was read from `web/public/data/profile.json`, `web/public/data/history.json` and `model/model.json`, which `python -m training.train` writes from the stored history.

- **Source:** Open-Meteo Air Quality API, CAMS global model (Copernicus Atmosphere Monitoring Service). License **CC-BY 4.0**; credit CAMS and Open-Meteo.
- **The values are modeled, not station measurements.** Nothing here comes directly from a monitoring station in Tehran.
- **Resolution:** the model grid is 0.4 degrees, about 44 km north to south and about 36 km east to west at Tehran's latitude: about 44 by 36 km. The map uses a 12-cell grid. Every place inside a cell shares one value.
- **Period:** 2022-08-04 to 2026-11-02, 1,552 days per cell.
- **Weather** (candidate inputs only): Open-Meteo Historical Forecast API, `models=ecmwf_ifs`, CC-BY 4.0, credit Open-Meteo and ECMWF (IFS open data).
- **City outline** on the Forecast map: © OpenStreetMap contributors, ODbL.

## The grid

Twelve cells in three rows and four columns, with centers at latitudes 35.2, 35.6, 36.0 and longitudes 50.8, 51.2, 51.6, 52.0. The API echoes back the requested coordinates, so the cells were found by comparing series of neighboring points, not from the returned coordinates (the method and the cell edges are in `docs/DATA_PROFILE.md`). Names are compass labels for each square's rough position, not administrative areas. West Tehran and East Tehran are the two central squares; the city centre lies about 0.01 degrees from the edge between them.

## Label

A cell-day is **positive (class 1)** when the Tehran calendar-day mean PM2.5 is **above 35.4 μg/m³**. A day needs at least 20 of its 24 hourly values, otherwise it has no label and is excluded; the mean uses the values that exist. A day is the Asia/Tehran calendar date (UTC+03:30, no summer time since 2022). A mean of exactly 35.4 is negative.

- 35.4 μg/m³ is the top of an EPA PM2.5 24-hour breakpoint: U.S. EPA, 89 FR 16202 (2024-03-06), Appendix G to 40 CFR Part 58. The site says "above 35.4 μg/m³" and claims no official category, because the EPA applies the breakpoints to monitor data and truncates a mean to one decimal first. That would change the class of 9 of the 18,624 labelled cell-days.
- **Labelled cell-days: 18,624** (12 cells × 1,552 days). Days excluded under 20 of 24 hours: 0.
- Pooled over the 12 cells, **7.0%** of labelled cell-days are positive. Cells range from 0.2% to 46.1%.

## Rows and inputs

Each row is one cell and one issue day D, predicting the label of D+1. The inputs are the 12 hourly values stamped from 21:00 UTC on D-1 to 08:00 UTC on D, which is everything up to the 12:00 Tehran cutoff (08:30 UTC). Nothing stamped at or after 09:00 UTC on D reaches a row; tests change late values and check that the row stays the same. The fourteen candidate features are, for each of PM2.5, PM10, NO2, SO2, CO, O3, and temperature, humidity and wind speed, the mean over the window, plus the window's total precipitation, the highest and the latest hourly PM2.5, and the sine and cosine of the target date's day of year. CAMS's own forecast for tomorrow is deliberately never an input. A row needs all 12 hours of all 10 inputs; nothing is imputed.

The deployed model uses five of the fourteen: `pm2_5_mean`, `pm2_5_max`, `pm2_5_last`, `season_sin`, `season_cos`.

## From labelled days to model rows

| Step | Rows after | Removed |
|---|---|---|
| Labelled cell-days | 18,624 | |
| With a full 12-hour input window | 18,600 | 24 |
| After removing summer-time days | 18,024 | 576 |
| After removing rows with incomplete inputs | 18,024 | 0 |

- **24 removed at the start:** the stored series begins at 2022-08-04 00:00 UTC, so the first two labelled days of each cell (2022-08-04 and 2022-08-05) have no complete 12-hour window.
- **576 removed for summer time (DST-era rows):** Iran used +04:30 summer time until 2022-09-21. On those days the 08:00 UTC stamp is 12:30 local time, past the cutoff, so issue days and target days that are not on +03:30 give no row. That is 48 days in each of the 12 cells. The first row of the dataset is therefore for 2022-09-23.
- **Missing hours:** 446,976 hours checked (every hour from each cell's first to last stored hour), **0** missing. An hour counts as missing if it is absent or any of the ten inputs is empty. `docs/DATA_PROFILE.md` mentions a 0.008% null share for the first hours seen in the earlier verification probe; the stored history has none.

## Splits

In time order, by the target date. The model is pooled across the twelve cells, so every cell is in all three parts.

| Part | Rows | From | To | Positive rate | Role |
|---|---|---|---|---|---|
| Training | 11,436 | 2022-09-23 | 2025-05-02 | 7.2% | Fits the model; scaling statistics come from these rows only |
| Selection | 2,208 | 2025-05-03 | 2025-11-02 | 3.8% | Chooses the feature set and the penalty strength |
| Held-out | 4,380 | 2025-11-03 | 2026-11-02 | 9.1% | Used once, for the reported result |

**Limitation of the selection set:** it is one warm half-year (May to early November 2025) with only **85 positive days** out of 2,208. Most of the positive days in this data fall between October and March (see the monthly table below), so the selection months say little about winter behavior. That limits how well settings could be chosen, which is why only two feature sets and five penalty strengths were compared.

## Positive rates over all labelled days

These rates use **all labelled days**, including the selection and held-out periods. They describe the data and are not training information.

| Year | Cell-days | Pooled rate |
|---|---|---|
| 2022 (from August 4) | 1,800 | 5.1% |
| 2023 | 4,380 | 6.5% |
| 2024 | 4,392 | 6.2% |
| 2025 | 4,380 | 9.3% |
| 2026 (to November 2) | 3,672 | 6.8% |

| Month | Cell-days | Pooled rate |
|---|---|---|
| January | 1,488 | 16.3% |
| February | 1,356 | 11.5% |
| March | 1,488 | 9.1% |
| April | 1,440 | 2.6% |
| May | 1,488 | 1.9% |
| June | 1,440 | 0.4% |
| July | 1,488 | 1.7% |
| August | 1,824 | 0.7% |
| September | 1,800 | 3.2% |
| October | 1,860 | 7.5% |
| November | 1,464 | 14.1% |
| December | 1,488 | 17.1% |

| Square | Labelled days | Positive rate | Mean PM2.5 (μg/m³) |
|---|---|---|---|
| West Tehran | 1,552 | 46.1% | 38.49 |
| East Tehran | 1,552 | 13.9% | 25.36 |
| Far West | 1,552 | 13.0% | 22.26 |
| South Central | 1,552 | 3.2% | 19.65 |
| Northwest Alborz | 1,552 | 1.7% | 17.35 |
| North Tehran | 1,552 | 1.4% | 15.62 |
| Southwest Plain | 1,552 | 1.4% | 16.86 |
| Southeast Plain | 1,552 | 1.4% | 17.56 |
| Northeast Tehran | 1,552 | 0.8% | 13.61 |
| Far Southeast | 1,552 | 0.5% | 14.96 |
| Far Northeast | 1,552 | 0.4% | 11.61 |
| Far East | 1,552 | 0.2% | 14.58 |

The rate changes a lot between years, and part of that may come from changes in the CAMS model, not only the air, so the history should be read with care. The 46.1% in the design notes is West Tehran alone, not the pooled grid; the site and baselines use the pooled 7.0%.

## Model and result

Logistic regression trained with this project's own gradient descent (`alpha = 0.5`, 10,000 updates, every candidate settled to a relative cost change below one part in ten million), on z-scored features, with a penalty on the weights. Ten candidates were compared by plain logistic cost (without the penalty) on the selection months; the held-out year was not used for any choice.

| Feature set | Penalty λ | Training cost | Selection cost | Chosen |
|---|---|---|---|---|
| pm_season | 0 | 0.1359 | 0.0961 | |
| pm_season | 10 | 0.1360 | 0.0947 | |
| pm_season | 100 | 0.1386 | 0.0912 | yes |
| pm_season | 1000 | 0.1551 | 0.1035 | |
| pm_season | 10000 | 0.2134 | 0.1472 | |
| all | 0 | 0.1273 | 0.0937 | |
| all | 10 | 0.1276 | 0.0941 | |
| all | 100 | 0.1312 | 0.0942 | |
| all | 1000 | 0.1482 | 0.1025 | |
| all | 10000 | 0.1944 | 0.1367 | |

`pm_season` is the five features listed above; `all` is the fourteen. The larger set fits the training days better but scored worse on the selection months. With one half-year and 85 positive days, the margin between the two is small and should not be over-read.

**Held-out logistic cost (lower is better), 4,380 cell-days, once:**

| | Held-out cost |
|---|---|
| Trained model | 0.1515 |
| Overall training rate, always (7.2%) | 0.3077 |
| Calendar month's training rate | 0.2950 |

The model beats both baselines. scikit-learn fitted on the same rows gives a held-out cost of 0.1515 as well (weights within 1.2e-7).

## Known issues and limits

- **Modeled data.** CAMS values, not station readings; about 44 by 36 km per square.
- **Live inputs may differ from the stored history.** The daily run fetches its inputs live, and the model was trained on values fetched earlier. When measured on 2026-11-03 over seven overlapping days, all six pollutants matched the history exactly and the model gave identical probabilities. Whether the hours of an issue day are revised later has not been checked yet; a saved live snapshot exists for re-checking.
- **Summer-time rows are dropped** (576 rows), so the dataset starts on 2022-09-23.
- **The selection set is warm-season only,** with 85 positives, which limits model choice.
- **Threshold convention.** `mean > 35.4` is a labeling rule on modeled cell means, not an EPA classification.
- **Non-commercial source.** Open-Meteo's free tier is for non-commercial use; the site has no ads or subscriptions.
- **Not an official alert or medical advice.**

## Reproduce

```bash
python -m pipeline.fetch --start 2022-08-04 --end 2026-11-02 --out data/raw/hourly.csv.gz
python -m training.train      # model/model.json and web/public/data/{profile,history,sample}.json
```

The raw data is git-ignored. Re-running changes the stored history and the numbers above only if the source revises its values.
