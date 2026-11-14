# Tehran Air Risk

Will the air in your part of Tehran be unhealthy tomorrow? Pick a place and see the chance, and see how the logistic regression behind it learns, step by step.

**Live site:** https://zahrabayatt.github.io/tehran-air-risk/

- **Forecast:** pick a landmark or one of Tehran's 377 neighbourhoods and see whether tomorrow is probably OK or probably unhealthy, with the chance shown as dots out of 10. A map shows the whole city, and the last days sit beside what really happened.
- **Data:** where the numbers come from, how the days are used, how far its chances held up on days it never saw, and what it cannot tell you.
- **Model Lab:** seventeen interactive steps, from the first day of data to today's forecast, worked through by hand.

## The result

- A day is **unhealthy** when its average PM2.5 is above 35.4 μg/m³, the point where the air quality index passes 100.
- The model reads today's PM2.5 up to noon, the time of year, and tomorrow's weather forecast (wind, air ceiling, rain, temperature and humidity).
- Trained on days from March 2024 to May 2025, settings chosen on May to November 2025, and checked once on the following twelve months, which it never saw.
- On that held-out year, a second look, its logistic cost is **0.1251**, under half that of simple guesses: the same chance every day costs 0.3086, and each month's usual chance costs 0.3155. Lower is better.
- When it gives a chance from 2 to 3 in 10 and from 4 to 9 in 10, it is too cautious: more of those days turn unhealthy than it says. The Data page shows this.

More detail, including every model that was tried: [`docs/DATA_CARD.md`](docs/DATA_CARD.md).

## Run it

The trained model and the forecasts so far are in the repository, so the site runs without downloading any data. Needs Node 22 or newer and [pnpm](https://pnpm.io/).

```bash
cd web
pnpm install
pnpm dev
```

To train the model again or make a forecast you need Python 3.10 or newer:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # use .venv/bin/python outside Windows
.venv/Scripts/python -m pipeline.fetch --start 2024-03-14 --end 2026-11-02 --out data/raw/hourly.csv.gz
.venv/Scripts/python -m pipeline.weather --start 2024-03-14 --end 2026-11-02 --out data/raw/weather.csv.gz
.venv/Scripts/python -m training.train
.venv/Scripts/python -m pipeline.predict
```

Every day a GitHub Actions workflow makes the new forecast from the saved model. It tries four times a day from 10:30 UTC and saves a forecast once both the air data and the weather forecast are ready. A forecast is never changed after it is saved. A day with no row was not recorded, and later days do not backfill it. The sources were ready in time on the checks of 2026-11-12 (CAMS, 10.1 hours after its run starts; 2026-11-04 measured 9.7) and 2026-11-03 (ECMWF, 6.8 hours; 2026-11-12 measured 6.4).

## Data

- **Air quality:** the CAMS global model (Copernicus Atmosphere Monitoring Service), through the [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api), under **CC-BY 4.0**. Hourly PM2.5 and other pollutants for twelve squares of about 44 by 36 km covering Tehran and its surroundings.
- **Weather forecast:** ECMWF's IFS forecast made at 03:30 Tehran time each day, through Open-Meteo's Single Runs API, under **CC-BY 4.0**.
- **Neighbourhoods and city outline:** © OpenStreetMap contributors, **ODbL**.
- **Threshold:** the 24-hour PM2.5 breakpoint of 35.4 μg/m³ from the U.S. EPA (89 FR 16202, 2024).

The values are modelled air, not station measurements. Open-Meteo's free tier is for non-commercial use, so the site has no ads. Raw data is not in the repository.

## Limitations

- Every value is modelled air on squares of about 44 by 36 km; every neighbourhood shares its square's forecast.
- Tomorrow's weather forecast can itself be wrong, and the model inherits that.
- The settings were chosen on half a year with few unhealthy days, and the held-out year had been looked at once before, by an earlier version.
- The forecast is a model estimate, not an official alert or medical advice.

## License

Code: MIT, see [`LICENSE`](LICENSE). Air data credit to CAMS and Open-Meteo, weather credit to ECMWF and Open-Meteo, both CC-BY 4.0. Neighbourhoods and city outline: ODbL.
