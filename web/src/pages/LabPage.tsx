import { useEffect, useState } from 'react';
import type { LabInputs } from '../lab/context';
import { loadLab } from '../lab/loadLab';
import { Lab } from './Lab';

const BASE = import.meta.env.BASE_URL;

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; inputs: LabInputs };

function useLabInputs() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    loadLab(BASE).then(
      (inputs) => live && setState({ status: 'ready', inputs }),
      (e: unknown) => {
        if (!live) return;
        const text = e instanceof Error ? e.message : String(e);
        setState({ status: 'error', message: text.startsWith('Could not load') ? text : `Could not load the Lab data. ${text}` });
      },
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  return { state, retry: () => setAttempt((a) => a + 1) };
}

export function LabPage() {
  useEffect(() => {
    document.title = 'Tehran Air Risk: Model Lab';
  }, []);
  const { state, retry } = useLabInputs();
  return (
    <main className="page">
      <div className="lab-head">
        <div className="lab-head__text">
          <h1>Model Lab</h1>
          <p className="lede">
            Build a classifier the way it is learned: why a line is not enough, the model, how it is trained, and what
            it does in the daily forecast. Each step has its math, a live worked example, and code explained line by
            line.
          </p>
        </div>
        <div className="lab-sandbox" data-testid="sandbox-label">
          Sandbox: does not affect the live model
        </div>
      </div>
      {state.status === 'loading' ? (
        <p role="status" className="notice">
          Loading the sample and the model…
        </p>
      ) : null}
      {state.status === 'error' ? (
        <div role="alert" className="notice notice--error">
          <p>
            <strong>The Lab did not load.</strong> {state.message}
          </p>
          <button type="button" className="btn btn--outline" onClick={retry}>
            Try again
          </button>
        </div>
      ) : null}
      {state.status === 'ready' ? <Lab inputs={state.inputs} /> : null}
    </main>
  );
}
