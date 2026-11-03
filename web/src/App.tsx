import { Suspense, lazy } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ComingPage } from './pages/ComingPage';
import { ForecastPage } from './pages/Forecast';

// The Lab (with its equations and code walkthroughs) loads only when its page is opened.
const LabPage = lazy(() => import('./pages/LabPage').then((m) => ({ default: m.LabPage })));

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ForecastPage />} />
          <Route
            path="lab"
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
          <Route path="data" element={<ComingPage title="Data" />} />
          <Route path="*" element={<ForecastPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
