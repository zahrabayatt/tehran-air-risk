import { NavLink, Outlet } from 'react-router-dom';
import { AUTHOR, GITHUB_URL, HOUSE_URL } from '../config';
import { useTheme } from '../useTheme';

const LINKS = [
  { to: '/', label: 'Forecast', end: true },
  { to: '/lab', label: 'Model Lab', end: false },
  { to: '/data', label: 'Data', end: false },
];

export function Layout() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'asphalt';
  return (
    <div className={dark ? 'app t dark' : 'app t'} data-theme={theme}>
      <header className="site-header">
        <div className="site-header__inner">
          <NavLink to="/" className="brand">
            Tehran Air Risk
          </NavLink>
          <nav aria-label="Main" className="pills">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className="pill">
                {l.label}
              </NavLink>
            ))}
            <button type="button" className="theme-toggle" onClick={toggle}>
              {dark ? 'Light' : 'Asphalt'}
            </button>
          </nav>
        </div>
      </header>
      <Outlet />
      <footer className="site-footer">
        <div className="site-footer__inner">
          <span>
            Built by {AUTHOR}. Air data: CAMS via Open-Meteo, CC-BY 4.0. City outline: © OpenStreetMap contributors, ODbL.
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
