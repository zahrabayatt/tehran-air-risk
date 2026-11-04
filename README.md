# Tehran Air Risk

A small website that forecasts, every day, how likely it is that tomorrow's average PM2.5 will be above 35.4 μg/m³ in each of twelve squares covering Tehran and its surroundings. It is built to show how a logistic regression model works, from the hourly data to the trained weights, and to be honest about what the forecast can and cannot tell you.

Live site: _link to be added when the site is published_

Sister project: [Tehran House Price Estimator](#) _(link to be added when that site is published)_, which uses linear regression on apartment ads.

The site has three pages:

- **Forecast:** a map of twelve squares, each about 44 by 36 km, colored by the model's chance that tomorrow's average PM2.5 is above 35.4 μg/m³. A place selector says which square a location belongs to, a second layer shows CAMS's own PM2.5 forecast for comparison (display only, never a model input), and a log shows the last 14 days for the selected square beside what happened. If the latest run is more than 48 hours old, the forecast is replaced by a message.
- **Model Lab:** seventeen guided steps, from the data and why a straight line is not enough, through the sigmoid, the decision boundary, the logistic loss, gradient descent, scaling and regularization, to the held-out result and the daily forecast. Every step has the math, the real project code explained line by line, and the scikit-learn equivalent. Experiments run in the browser on a small sample and never change the live model.
- **Data:** where the numbers come from, the sources and licences, how days are split, the counts from labelled days to model rows, positive rates by year, month and square, the fields used, and the limitations.

## Result, in plain words

The values are modeled air from CAMS, not measurements from a station. A day is positive when the day's mean PM2.5 is **above 35.4 μg/m³** (the label needs at least 20 of 24 hourly values). The model reads PM2.5 up to 12:00 Tehran time and the time of year, and predicts the next day. Days were split in time order: training days first, then six months to choose settings, and the final twelve months held out and looked at once.

On those held-out days (4,380 cell-days, 9.1% of them positive) the logistic cost, where lower is better, was:

| Guess | Held-out cost |
|---|---|
| The trained model | **0.1515** |
| Always the overall training rate (7.2%) | 0.3077 |
| Each calendar month's training rate | 0.2950 |

The model beats both simple guesses. The comparison is made on the same days, with the baselines fitted on training rows only. The model is not tuned after seeing the held-out year. Two cautions go with it:

- The selection months are one warm half-year with only 85 positive days, so the choice between settings rests on very little. Only two feature sets and five penalty strengths were compared.
- The forecast is for a square of about 44 by 36 km, not a street or a neighborhood, and it is a model estimate. It is not an official alert or medical advice.

The full reading is in [`docs/DATA_CARD.md`](docs/DATA_CARD.md).

## How the daily forecast works

A scheduled GitHub Actions workflow ([`.github/workflows/daily.yml`](.github/workflows/daily.yml)) runs every day at 13:30 UTC (17:00 in Tehran, well after the 12:00 Tehran cutoff, and later than Open-Meteo published the day's 00 UTC CAMS run in the one check so far, about 9.7 hours after its start):

1. It fetches today's hourly values for all twelve squares and builds the model's inputs from the 12 hours up to the cutoff only. The target date comes from Tehran time inside the script, never from the runner's clock.
2. The one **frozen** model (`model/model.json`) gives each square a probability for tomorrow. Retraining is a deliberate manual step, never part of the daily run.
3. If a square's data cannot be fetched, the run records a **gap** with the reason. Nothing is filled in, interpolated or invented.
4. For earlier forecasts whose day has ended, it fetches what actually happened and records the outcome. A forecast is never changed afterwards.
5. It commits only `data/predictions.json`, builds the site and deploys it to GitHub Pages.

CAMS's own forecast for tomorrow is stored for display and is never an input, because the model would then be a copy of that forecast.

## Run it

Needs Python 3.10 or newer, Node 22 or newer, and [pnpm](https://pnpm.io/).

### The site

```bash
cd web
pnpm install
pnpm dev          # development server
pnpm test         # unit tests
pnpm build        # type check and production build into web/dist
pnpm e2e          # browser tests and accessibility checks (run `pnpm exec playwright install chromium` once)
```

The trained model (`model/model.json`) and the forecasts so far (`data/predictions.json`) are in the repository, so the site runs without any data download. `pnpm dev` and `pnpm build` copy both into `web/public/data`; the copies are not committed.

### Training and the daily run

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt                       # Windows; use .venv/bin/python elsewhere
.venv/Scripts/python -m pytest                                                # all tests use small fixtures; no data download needed
.venv/Scripts/python -m pipeline.fetch --start 2022-08-04 --end 2026-11-02 --out data/raw/hourly.csv.gz
.venv/Scripts/python -m training.train                                        # trains, writes model/model.json and web/public/data/*.json
.venv/Scripts/python -m pipeline.predict                                      # issues today's forecast into data/predictions.json
```

Fetching the history takes a long time because the free API has rate limits. Training rewrites the model and the data files. The held-out year is meant to be looked at once; changing the model after seeing it means the held-out claim no longer holds.

## Data

- **Air quality:** [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api), CAMS global model (Copernicus Atmosphere Monitoring Service). License **CC-BY 4.0**; credit CAMS and Open-Meteo. PM2.5, PM10, NO2, SO2, CO and O3, hourly, for 12 cells of the model grid (about 44 by 36 km each), from 2022-08-04 to 2026-11-02 (1,552 days per cell, 18,624 labelled cell-days, 7.0% positive).
- **Weather:** Open-Meteo Historical Forecast API (ECMWF IFS), CC-BY 4.0; credit Open-Meteo and ECMWF (IFS open data). Built as candidate inputs; the deployed model does not use it.
- **City outline:** © OpenStreetMap contributors, **ODbL**, simplified and embedded in the site.
- **Threshold:** the PM2.5 24-hour breakpoint of 35.4 μg/m³ from U.S. EPA, 89 FR 16202 (2024-03-06), Appendix G to 40 CFR Part 58. The site says "above 35.4 μg/m³" and does not claim an official category.

Open-Meteo's free tier is for non-commercial use, so the site has no ads or subscriptions. The raw data is not in the repository. Details: [`docs/DATA_CARD.md`](docs/DATA_CARD.md) and [`docs/DATA_PROFILE.md`](docs/DATA_PROFILE.md).

## Limitations

- Every value is modeled, not a station measurement, on squares of about 44 by 36 km. Every place in a square shares one forecast.
- Live inputs may differ from the stored history the model was trained on. When measured on 2026-11-03 they were identical; whether hours are revised later has not been checked yet (see "Live vs history" in `docs/DATA_PROFILE.md`).
- The forecast is a model estimate. It is not an official alert or medical advice.
- The selection months have only 85 positive days, which limits model choice.
- About four years of history. Yearly positive rates vary (5.1% to 9.3%), partly perhaps from changes in the CAMS model.
- The label uses a plain `mean > 35.4` rule. The EPA cuts a mean to one decimal first, which would change 9 of 18,624 cell-days.

## Course scope

This project follows **Course 1 of the Machine Learning Specialization** (Supervised Machine Learning: Regression and Classification), the logistic regression part: classification, the sigmoid, the decision boundary, the logistic loss and cost, gradient descent, vectorization, learning rate, feature scaling, feature engineering, overfitting and regularization. The linear regression half is a separate project, `tehran-house-price`.

Out of scope, because they are not part of what this project covers: Accuracy, Precision, Recall, F1-score, Confusion matrix, ROC-AUC, decision threshold analysis, and named error metrics such as MSE, RMSE and MAE. The decision threshold on the probability is fixed at 0.5. A test (`tests/test_scope.py`) fails if these names appear anywhere in the site source, the training and pipeline code, the exported data or the docs. Only two things are exempt: the one line in this README, the progress tracker and the project spec that says the names are out of scope, and the site's own test files, which hold the list so they can check that no page shows it.

[`docs/LEARNING_PROGRESS_TRACKER.md`](docs/LEARNING_PROGRESS_TRACKER.md) records which concepts are implemented and where.

## Repository

```text
training/   labels, features, model, training, exports for the site
pipeline/   fetching, the 12-cell grid, the daily forecast, outcomes
tests/      Python tests
model/      model.json, the trained model
data/       predictions.json (the daily forecasts); raw data is git-ignored
web/        the site (Vite, React, TypeScript)
docs/       project spec, learning notes, data card, data profile, changelog, progress tracker
```

## License

Code: MIT, see [`LICENSE`](LICENSE). Air data credit stays with CAMS and Open-Meteo, and weather credit with Open-Meteo and ECMWF, under CC-BY 4.0; the city outline is ODbL.
