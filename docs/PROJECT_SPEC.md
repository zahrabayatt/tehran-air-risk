# Tehran Air Risk: Project Spec

Design date: 2026-11-01. Requirements source: the course reference notes kept outside this repository. Where this spec is more specific than those notes, this spec wins.

This file keeps the parts of the shared design that apply to this repository. The apartment price estimator (linear regression) is a separate project in its own repository, `tehran-house-price`, with its own spec. It is not part of this site.

## 1. Intent

A public, working portfolio site that demonstrates what the author learned in **Course 1 of the Machine Learning Specialization** (Supervised Machine Learning: Regression and Classification), applied to a real Tehran question with real data, and honest about its limits. The classification half of the course is used here: logistic regression.

Audience: recruiters and technical reviewers first; curious non-technical visitors second.

Success means:

- The site is live on a public URL and the repository is public.
- A non-technical visitor understands the forecast and its limits without reading any math.
- A reviewer can inspect the data, math, training, plots, and real code for every concept used.
- Educational controls cannot change the deployed model.
- The daily forecast keeps running without hand work, and a failed day is recorded as a gap, never invented.
- The author can explain every part in an interview.

## 2. Decisions

| Topic | Decision |
|---|---|
| Course scope | The logistic regression part of Course 1 |
| Out of scope | Accuracy, Precision, Recall, F1, Confusion Matrix, ROC-AUC, MSE, RMSE, L1 loss, L2 loss, decision-threshold analysis, and algorithms beyond logistic regression |
| UI language | English only |
| Repository | `tehran-air-risk` |
| Hosting | GitHub Pages. The daily forecast runs in GitHub Actions and is committed as a static file |
| Data terms | Air data keeps CC-BY 4.0 attribution (CAMS and Open-Meteo). The free API tier is non-commercial, so the site has no ads or subscriptions |

## 3. Architecture

```text
Offline Python training --> model/model.json --+
                                               +--> daily GitHub Actions run --> data/predictions.json --> static React site
Open-Meteo hourly data (12 cells) -------------+
```

- **Training:** Python 3.10+, NumPy from-scratch gradient descent, pandas for preparation, scikit-learn only as a comparison check. Dependencies pinned.
- **Daily run:** one scheduled workflow at 10:00 UTC (13:30 Tehran): fetch all 12 cells, build features, apply the one frozen model, append to `predictions.json`, fill in earlier outcomes, commit that one file, build, deploy.
- **Site:** Vite, React, TypeScript. `HashRouter`, so deep links work on Pages. KaTeX for math. SVG charts. The Forecast page reads `predictions.json`; the Lab and Data pages read the exported model, profile and history files.
- **Model file:** `model.json` holds feature names and order, weights, bias, scaling means and standard deviations, chosen hyperparameters, train, selection and held-out cost, both baselines, the candidates compared, cost history, row counts, date ranges, training timestamp, measured runtime, and environment.

## 4. Data and model

### Data

- Source: Open-Meteo Air Quality API (CAMS global), a 12-cell grid covering Tehran and its surroundings (cell centers at latitudes 35.2, 35.6, 36.0 and longitudes 50.8, 51.2, 51.6, 52.0), timezone `Asia/Tehran`, CC-BY 4.0 with CAMS and Open-Meteo attribution.
- Usable history starts 2022-08-04 for all 12 cells (1,552 days per cell through 2026-11-02). Values are model-derived on 0.4 degree cells (about 44 km north to south, 36 km east to west), never described as station measurements. Open-Meteo's Tehran hour label 00:00 is 21:00 UTC; inputs before the 12:00 cutoff use labels 00:00 to 11:00.
- Weather: today's weather up to the cutoff only (temperature, humidity, wind speed, precipitation), from the Historical Forecast API with `models=ecmwf_ifs`. Verified in the source check: that API joins the first hours of each model run, so it cannot reproduce tomorrow's forecast as issued, and the Single Runs API that could starts on 2024-03-14, which would leave about 14 months to train on. Boundary layer height is excluded (it starts 2024-09-01, with gaps).

### Target

Class 1 when tomorrow's mean PM2.5 exceeds **35.4 μg/m³**, over the Tehran calendar day, requiring at least 20 of 24 hourly values; otherwise the day has no label and is excluded. Rate pooled over the 12 cells: 7.0% positive (West Tehran alone 46.1%; cells range from 0.2% to 46.1%). The site says "above 35.4 μg/m³" and does not claim an EPA category, because the EPA truncates to one decimal (it would differ on 9 of 18,624 cell-days). Citation: 89 FR 16202 (2024-03-06), Appendix G to 40 CFR Part 58.

### Model

- Cutoff: today 12:00 Tehran time. Pollutant inputs use only hours up to the cutoff.
- Candidate features: today's PM2.5, PM10, NO2, SO2, CO and O3 means; the highest and latest hourly PM2.5; today's weather to the cutoff (temperature, humidity, wind, precipitation); `sin` and `cos` of day of year. Fourteen in all.
- Deliberately excluded: CAMS's own pollution forecast for tomorrow, which would turn the model into a copy of that forecast.
- Split, in time order: the final 12 months are the held-out set; the 6 months before them are the selection set; all earlier days train the model. Feature and hyperparameter choices use the selection set. The held-out set is used once, for the reported result.
- Decision threshold: 0.5, fixed. Threshold analysis is out of scope.
- Baselines: overall training rate and per-calendar-month training rate. Compare by logistic cost on the held-out set. If the model does not beat both, the site says so plainly, and the model is not tuned using held-out data to change that result.

### Daily pipeline

- The deployed model is frozen; retraining is a deliberate manual action.
- The target date comes from Tehran time inside the script, never from the runner's clock.
- On API failure, retry; if still failing, record a gap with the reason and fabricate nothing.
- Each entry stores the issue time, target date, probability, class, model version, and later the outcome.
- Limitation to disclose: live inputs may be forecast-based while historic inputs reflect stored model runs, so live behavior can differ from the held-out result.

### Forecast page

The page leads with the answer for the city in one headline and a visible last-updated time, then an interactive map as the main view: one square per CAMS cell, Tehran's real outline from OpenStreetMap (ODbL, simplified and embedded with no map-tile dependency), and a place selector showing which cell a location belongs to. The map switches between the model's chance of crossing the threshold and CAMS's own PM2.5 forecast, shown only for display and never used as a model input. The map states that each square is about 44 by 36 km and that every place inside it shares one forecast. Also: a plain-language verdict for the selected cell and a named date, probability labeled as a model estimate, threshold definition, inputs used, a 14-day forecast log beside later outcomes, a stale banner replacing the forecast if the latest run is over 48 hours old, and limitations: modeled data, about 44 by 36 km resolution, not an official alert or medical advice.

## 5. Site structure

The site has a `Forecast` page, a `Model Lab`, and a `Data` page. Code lives inside the Model Lab, not on its own page.

### Model Lab

A guided sequence of 17 steps. Every experiment is labeled `Sandbox: does not affect the live model`, runs in the browser on a small embedded sample, and has a reset. Sandbox runtime is measured with `performance.now()`. No timing value is ever hard-coded. Each step offers switchable plot views, a side panel of live values, and controls for what that step teaches; steps from Gradient descent onward share one pattern of sliders, run controls and a replay slider. Below the plots every step shows the math, how this project implements it, and the scikit-learn equivalent with a note on any difference.

A step never relies on a concept from a later step. Held-out comparisons appear only in the final project steps, which are labeled as project steps rather than course concepts.

| Part | Steps |
|---|---|
| The problem | Data; Label and timing; Why not linear regression? |
| The model | Sigmoid; Logistic model; Decision boundary |
| The cost | Why not squared error?; Logistic loss; Cost function |
| Training | Gradient descent; Vectorization; Learning rate; Feature scaling |
| Generalizing | Feature engineering; Overfitting and regularization |
| The result | Held-out result; Daily forecast |

Snippets are extracted at build time from real source files, with GitHub permalinks. The Lab also shows the live model's measured training run and a NumPy versus scikit-learn cost comparison.

### Data

Source, licence, period, resolution, the split, the counts from labelled days to model rows, missing hours, positive rates by year, month and square, fields, and limitations. Rates on this page use all labelled days and are labeled that way. The page never shows anything that is not an aggregate.

## 6. Visual design

Modern and clean, with rounded cards in a flexible grid, a pill-shaped navigation bar, and large numbers. Geist for all text and Geist Mono for data. One token system with a teal accent. Risk colors are orange and blue, always paired with a word or symbol. Mobile-first, light and asphalt themes, WCAG AA, full keyboard use, and meaning never carried by color alone. Fonts are self-hosted.

## 7. Testing

- **Training:** analytic gradients match numeric gradients; cost falls at a small learning rate; results agree with scikit-learn within a stated tolerance; repeat runs are deterministic.
- **Leakage:** every air input is at or before the cutoff; scaling statistics use training rows only; selection dates follow training dates, and held-out dates follow selection dates.
- **Parity:** TypeScript and Python predictions match on fixture inputs.
- **Isolation:** running every sandbox experiment leaves the deployed model object unchanged.
- **Scope:** a repository check fails if out-of-scope metric names appear in site source, training and pipeline code, exported data, or the docs.
- **Site:** Playwright covers the main journeys, including stale and empty states; axe checks every route in both themes at 1280 and 390 pixels wide, and the page must not scroll sideways at 390.
- **Pipeline:** API failure produces a recorded gap with no fabricated values.
- **Delivery:** the workflows are pinned to exact versions, the deploy waits for CI on `main`, and both deploy paths share one Pages concurrency group.

## 8. Repository and delivery

```text
<repo>/
  training/   labels, features, model, train, exports for the site
  pipeline/   fetch, grid, predict, fill outcomes, store
  tests/      Python tests
  model/      model.json
  data/       predictions.json; raw data folder (git-ignored)
  web/        Vite, React, TypeScript
  docs/       PROJECT_SPEC, LEARNING_NOTES, DATA_CARD, DATA_PROFILE, CHANGELOG, LEARNING_PROGRESS_TRACKER
  README.md
```

- Raw data is never committed. Code is MIT. Air data keeps CC-BY attribution.
- CI runs the tests on push and pull request. A separate workflow deploys through GitHub Pages Actions after CI succeeds on a push to `main`. The daily workflow deploys its own commit, because a commit pushed with the workflow token does not start other workflows. Its commits also keep the schedule active under GitHub's 60-day inactivity rule.
- `LEARNING_PROGRESS_TRACKER.md` is updated only where a concept is really implemented. The date log uses real dates.
- `LEARNING_NOTES.md` includes technical explanations and leaves "In my own words" for the author.

## 9. Differences between the design and the build

- History starts on 2022-08-04, one day earlier than the first design estimate, because the first partial day already has 21 of 24 hours.
- The first model row is for 2022-09-23: 576 rows on Iran's summer time (until 2022-09-21) are dropped, because the 12:00 cutoff moves on those days.
- The deployed model reads five of the fourteen candidate features. The weather features are part of the larger set, which fitted the training days better but scored worse on the selection months.
- The selection months are one warm half-year with 85 positive days, which limits model choice. The site says so.
- The Data page shows aggregate counts and rates, not sample records.

## 10. Known risks

| Risk | Handling |
|---|---|
| CAMS values are modeled, not measured | Labeled everywhere; never called station data |
| Live inputs may differ from the stored history | Measured and reported in `DATA_PROFILE.md`; identical on 2026-11-03, later revisions not yet checked |
| Few positive days in the selection set | Only ten candidates compared; stated on the Data page and in the data card |
| A model that does not beat simple guesses | The site would say so plainly; today it beats both baselines on the held-out year |
| The free API can fail or rate-limit | Retries, then a recorded gap; the site shows "no forecast" for that square and day |
| The scheduled workflow stops after 60 inactive days | The daily commit of `predictions.json` counts as activity |
