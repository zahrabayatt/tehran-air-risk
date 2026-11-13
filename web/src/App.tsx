import { Suspense, lazy } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ForecastPage } from './pages/Forecast';

// The Lab (with its equations and code walkthroughs) loads only when its page is opened.
const LabPage = lazy(() => import('./pages/LabPage').then((m) => ({ default: m.LabPage })));
// The Data page carries the profile and history files, so it loads only when its page is opened too.
const DataPage = lazy(() => import('./pages/DataPage').then((m) => ({ default: m.DataPage })));

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ForecastPage />} />
          <Route
            path="lab/:step?"
            element={
              <Suspense
                fallback={
                  <main className="page">
                    <p role="status" className="notice">
                      Loading the Model Lab…
                    </p>
                  </main>
                }
              >
                <LabPage />
              </Suspense>
            }
          />
          <Route
            path="data"
            element={
              <Suspense
                fallback={
                  <main className="page">
                    <p role="status" className="notice">
                      Loading the Data page…
                    </p>
                  </main>
                }
              >
                <DataPage />
              </Suspense>
            }
          />
          <Route path="*" element={<ForecastPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
