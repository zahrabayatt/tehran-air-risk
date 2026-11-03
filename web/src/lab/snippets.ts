import { snippets } from 'virtual:lab-snippets';
import type { Snippet } from 'virtual:lab-snippets';

export type { Snippet };

/**
 * A code block read from the Python source at build time (plugins/code-snippets.ts). The build
 * fails if a name asked for with lab('name') in src/lab/stages is missing, so this throws
 * only if a name is built at run time.
 */
export function lab(name: string): Snippet {
  const s = snippets[name];
  if (!s) throw new Error(`No lab code block named "${name}" in training/ or pipeline/`);
  return s;
}

/** Every block in the source, for tests. */
export const allBlocks = (): Snippet[] => Object.values(snippets);
