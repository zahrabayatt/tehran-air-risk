import type { Snippet } from '../lab/snippets';

type Props = {
  blocks: Snippet[];
  explanations: Record<string, Record<string, string>>;
  /** Repository address; with it the file names become links. Empty hides the links. */
  githubUrl: string;
};

/** Where a file lives in the repository, or null when no repository address is set. */
export function sourceLink(githubUrl: string, block: Snippet): string | null {
  if (!githubUrl) return null;
  const end = block.startLine + block.lines.length - 1;
  return `${githubUrl.replace(/\/+$/, '')}/blob/${__COMMIT__}/${block.file}#L${block.startLine}-L${end}`;
}

/** The rows of one block: blank lines are squeezed to one, and a line with no explanation gets none. */
export function codeRows(block: Snippet, explain: Record<string, string> = {}): Array<{ code: string; note: string }> {
  const rows: Array<{ code: string; note: string }> = [];
  for (const line of block.lines) {
    if (line === '' && (rows.length === 0 || rows[rows.length - 1].code === '')) continue;
    rows.push({ code: line, note: line === '' ? '' : (explain[line] ?? '') });
  }
  while (rows.length > 0 && rows[rows.length - 1].code === '') rows.pop();
  return rows;
}

export function CodeWalkthrough({ blocks, explanations, githubUrl }: Props) {
  return (
    <div className="code-walk">
      {blocks.map((block) => {
        const link = sourceLink(githubUrl, block);
        const end = block.startLine + block.lines.length - 1;
        const where = `${block.file}, lines ${block.startLine} to ${end}`;
        return (
          <div key={block.name} className="code-block">
            <div className="code-block__file">{link ? <a href={link}>{where}</a> : <span>{where}</span>}</div>
            <div className="code-scroll" role="region" aria-label={`Code, ${where}`} tabIndex={0}>
              <table className="code-table">
                <tbody>
                  {codeRows(block, explanations[block.name]).map((r, i) => (
                    <tr key={i}>
                      <td className="code-table__code">{r.code}</td>
                      <td className="code-table__note">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
