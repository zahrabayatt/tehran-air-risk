import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ComingPage } from './pages/ComingPage';
import { ForecastPage } from './pages/Forecast';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ForecastPage />} />
          <Route path="lab" element={<ComingPage title="Model Lab" />} />
          <Route path="data" element={<ComingPage title="Data" />} />
          <Route path="*" element={<ForecastPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
