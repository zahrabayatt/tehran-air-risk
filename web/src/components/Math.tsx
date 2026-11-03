import katex from 'katex';
import 'katex/dist/katex.min.css';

type MathProps = {
  tex: string;
  /** A centred equation on its own line. Default is inline. */
  display?: boolean;
};

/** TeX to HTML, bundled with the site. A formula KaTeX cannot read is shown as plain text. */
export function renderTex(tex: string, display: boolean): { html: string; ok: boolean } {
  try {
    return { html: katex.renderToString(tex, { displayMode: display, throwOnError: true, output: 'htmlAndMathml' }), ok: true };
  } catch {
    return { html: '', ok: false };
  }
}

export function Math({ tex, display = false }: MathProps) {
  const { html, ok } = renderTex(tex, display);
  if (!ok) return <code>{tex}</code>;
  const Tag = display ? 'div' : 'span';
  return <Tag className={display ? 'math math--display' : 'math'} dangerouslySetInnerHTML={{ __html: html }} />;
}
