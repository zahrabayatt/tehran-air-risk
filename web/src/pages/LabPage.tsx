import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { CodeWalkthrough } from '../components/CodeWalkthrough';
import { GITHUB_URL } from '../config';
import { createScope, loadStepData } from '../lab/data';
import type { LabDataName } from '../lab/data';
import { EXPLANATIONS } from '../lab/explanations';
import { STEPS } from '../lab/steps';
import type { StepModule } from '../lab/steps';
import 'katex/dist/katex.min.css';
import './lab.css';
import '../lab/lab-steps.css';

/** The section names in the order the steps first use them. */
const SECTIONS = [...new Set(STEPS.map((s) => s.section))];

/** The step number in the address, 1 when it is missing or not a step. */
export function stepFromParam(param: string | undefined): number {
  const n = Number(param);
  return Number.isInteger(n) && n >= 1 && n <= STEPS.length ? n : 1;
}

/** Placeholder blocks in the shape of a step, shown while its code loads. */
function Skeleton() {
  return (
    <section className="card" aria-hidden="true">
      <div className="sk" style={{ width: 90, height: 14, marginBottom: 12 }} />
      <div className="sk" style={{ width: '34%', height: 30, marginBottom: 12 }} />
      <div className="sk" style={{ width: '70%', height: 16, marginBottom: 22 }} />
      <div className="two">
        <div className="sk" style={{ height: 420, borderRadius: 14 }} />
        <div className="sk" style={{ height: 420, borderRadius: 14 }} />
      </div>
    </section>
  );
}

type Tab = 'code' | 'math' | 'sk';

function StepView({ n, mod }: { n: number; mod: StepModule }) {
  const info = STEPS[n - 1];
  const [tab, setTab] = useState<Tab>('code');
  const [failed, setFailed] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    started.current = true;
    let stop: (() => void) | null = null;
    try {
      stop = mod.mount({
        load: (name) =>
          loadStepData(name as LabDataName).catch((e: unknown) => {
            setFailed(e instanceof Error ? e.message : String(e));
            return new Promise(() => {}); // the step waits forever; the error message explains
          }),
        scope: createScope,
      });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
    return () => stop?.();
  }, [mod]);

  const tabs: Array<[Tab, string]> = [['code', 'The code'], ['math', 'The math']];
  if (mod.skHtml) tabs.push(['sk', 'scikit-learn']);
  const prev = STEPS[n - 2];
  const next = STEPS[n];

  return (
    <div className={`ls-${n}`}>
      {failed ? (
        <div role="alert" className="lab-error">
          <strong>This step did not load.</strong> {failed} Reload the page to try again.
        </div>
      ) : null}
      <div dangerouslySetInnerHTML={{ __html: mod.html }} />
      <section className="card" aria-label="Code and math">
        <div className="tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id}
              aria-controls={`pane-${id}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {/* The panes share one grid cell, so switching tabs never changes the height of the page. */}
        <div className="panes">
          <div id="pane-code" role="tabpanel" aria-labelledby="tab-code" className={tab === 'code' ? '' : 'hidden'}>
            <CodeWalkthrough blocks={info.code()} explanations={EXPLANATIONS} githubUrl={GITHUB_URL} />
          </div>
          <div id="pane-math" role="tabpanel" aria-labelledby="tab-math" className={tab === 'math' ? '' : 'hidden'}
            dangerouslySetInnerHTML={{ __html: mod.mathHtml }} />
          {mod.skHtml ? (
            <div id="pane-sk" role="tabpanel" aria-labelledby="tab-sk" className={tab === 'sk' ? 'code' : 'code hidden'}
              dangerouslySetInnerHTML={{ __html: mod.skHtml }} />
          ) : null}
        </div>
      </section>
      <nav className="nextrow" aria-label="Previous and next step">
        {prev ? <Link className="prev" to={`/lab/${prev.n}`}>← {prev.title}</Link> : null}
        {next ? (
          <Link className="next" to={`/lab/${next.n}`}>Next: {next.title} →</Link>
        ) : (
          <Link className="next" to="/">Back to the forecast →</Link>
        )}
      </nav>
    </div>
  );
}

export function LabPage() {
  const n = stepFromParam(useParams().step);
  const info = STEPS[n - 1];
  const [loaded, setLoaded] = useState<{ n: number; mod: StepModule } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `Tehran Air Risk: Model Lab, ${info.title}`;
    let live = true;
    setError(null);
    info.load().then(
      (mod) => live && setLoaded({ n, mod }),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    window.scrollTo({ top: 0 });
    // On a phone the step list is a sideways strip: bring the open step into view.
    const nav = document.querySelector<HTMLElement>('.lab-nav');
    const link = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (nav && link && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = link.offsetLeft - nav.clientWidth / 2 + link.offsetWidth / 2;
    return () => {
      live = false;
    };
  }, [n, info]);

  return (
    <main className="page lab-page">
      <div className="lab-grid lab">
        <nav className="lab-nav" aria-label="Steps">
          <h1>Model Lab</h1>
          {SECTIONS.map((section) => (
            <div key={section}>
              <p>{section}</p>
              {STEPS.filter((s) => s.section === section).map((s) => (
                <NavLink key={s.n} to={`/lab/${s.n}`} aria-current={s.n === n ? 'page' : undefined}>
                  <span>{s.n}</span>
                  {s.title}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div>
          {error ? (
            <div role="alert" className="lab-error">
              <strong>This step did not load.</strong> {error} Check the connection and reload the page.
            </div>
          ) : loaded && loaded.n === n ? (
            <StepView key={n} n={n} mod={loaded.mod} />
          ) : (
            <Skeleton />
          )}
        </div>
      </div>
    </main>
  );
}
