/** Code blocks read from the Python source at build time by plugins/code-snippets.ts. */
declare module 'virtual:lab-snippets' {
  export interface Snippet {
    name: string;
    /** Repository path with forward slashes, e.g. training/model.py. */
    file: string;
    /** Line number of the first code line in that file, counting from 1. */
    startLine: number;
    lines: string[];
  }
  export const snippets: Record<string, Snippet>;
}
