import { useEffect } from 'react';

/** Placeholder for a section that is still being built. Replaced by the real page in a later task. */
export function ComingPage({ title }: { title: string }) {
  useEffect(() => {
    document.title = `Tehran Air Risk: ${title}`;
  }, [title]);
  return (
    <main className="page">
      <h1>{title}</h1>
      <p className="lede">This section is being built.</p>
    </main>
  );
}
