import { NavLink, Outlet } from 'react-router-dom';
import { AUTHOR, GITHUB_URL, HOUSE_URL } from '../config';
import { useTheme } from '../useTheme';

const LINKS = [
  { to: '/', label: 'Forecast', end: true },
  { to: '/data', label: 'Data', end: false },
  { to: '/lab', label: 'Model Lab', end: false },
];

function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function Layout() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <div className={dark ? 'app t dark' : 'app t'} data-theme={theme}>
      <header className="site-header">
        <div className="site-header__inner">
          <NavLink to="/" className="brand">
            Tehran Air Risk
          </NavLink>
          <div className="site-header__right">
            <nav aria-label="Main" className="pills">
              {LINKS.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className="pill">
                  {l.label}
                </NavLink>
              ))}
            </nav>
            <button type="button" className="theme-btn" onClick={toggle} aria-label={label} title={label}>
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
      </header>
      <Outlet />
      <footer className="site-footer">
        <div className="site-footer__inner">
          <span>
            Built by {AUTHOR}. Air data: CAMS via Open-Meteo. Weather: ECMWF via Open-Meteo. Both CC-BY 4.0. City outline: © OpenStreetMap contributors, ODbL.
            {GITHUB_URL ? (
              <>
                {' '}
                <a href={GITHUB_URL}>GitHub</a>
              </>
            ) : null}
          </span>
          {HOUSE_URL ? <a href={HOUSE_URL}>Other project: Tehran House Price</a> : null}
        </div>
      </footer>
    </div>
  );
}
