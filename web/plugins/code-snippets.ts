import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Exposes `virtual:lab-snippets`: the code the Lab shows, read from the Python source.
 *
 * A block starts at a `# lab:<name>` line and ends at the next `# endlab` line, in any
 * `.py` file directly inside the source folders (this repository: `training/` and `pipeline/`). The page asks for a block with `lab('<name>')` (src/lab/snippets.ts).
 * Every name asked for anywhere under the stages folder must exist, or the build fails, so
 * the Lab can never show code that is not in the repository.
 */

export interface Snippet {
  name: string;
  /** Repository path, with forward slashes, e.g. training/model.py. */
  file: string;
  /** Line number of the first code line in that file, counting from 1. */
  startLine: number;
  lines: string[];
}

const VIRTUAL_ID = 'virtual:lab-snippets';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** The blocks in one file. Throws on a nested, unterminated or stray marker, or a repeated name. */
export function extractBlocks(text: string, file: string): Snippet[] {
  const out: Snippet[] = [];
  let open: Snippet | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trimEnd();
    const start = /^\s*# lab:([A-Za-z0-9_]+)\s*$/.exec(line);
    if (start) {
      if (open) throw new Error(`${file}:${i + 1}: block "${start[1]}" starts inside block "${open.name}"`);
      if (out.some((b) => b.name === start[1])) throw new Error(`${file}:${i + 1}: block "${start[1]}" appears twice`);
      open = { name: start[1], file, startLine: i + 2, lines: [] };
      return;
    }
    if (/^\s*# endlab\s*$/.test(line)) {
      if (!open) throw new Error(`${file}:${i + 1}: "# endlab" without a block`);
      out.push(open);
      open = null;
      return;
    }
    if (open) open.lines.push(line);
  });
  if (open) throw new Error(`${file}: block "${(open as Snippet).name}" is never closed with "# endlab"`);
  return out;
}

function listFiles(dir: string, ext: string, deep: boolean): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory() && deep) out.push(...listFiles(p, ext, deep));
    else if (e.isFile() && e.name.endsWith(ext)) out.push(p);
  }
  return out.sort();
}

/** Every block in the .py files of the source folders, by name. A name used in two files is an error. */
export function readBlocks(sourceDirs: string | string[], repoRoot: string): Record<string, Snippet> {
  const all: Record<string, Snippet> = {};
  for (const dir of [sourceDirs].flat()) {
    for (const path of listFiles(dir, '.py', false)) {
      const rel = relative(repoRoot, path).split('\\').join('/');
      for (const b of extractBlocks(readFileSync(path, 'utf8'), rel)) {
        if (all[b.name]) throw new Error(`block "${b.name}" is in both ${all[b.name].file} and ${rel}`);
        all[b.name] = b;
      }
    }
  }
  return all;
}

/** Names asked for as lab('name') in any TypeScript file under the stages folder. */
export function requiredBlocks(stagesDir: string): string[] {
  const names = new Set<string>();
  for (const path of listFiles(stagesDir, '.ts', true)) {
    if (/\.test\.ts$/.test(path)) continue;
    for (const m of readFileSync(path, 'utf8').matchAll(/\blab\(\s*'([A-Za-z0-9_]+)'\s*\)/g)) names.add(m[1]);
  }
  return [...names].sort();
}

/** The names in `required` that `blocks` does not have. */
export function missingBlocks(blocks: Record<string, Snippet>, required: string[]): string[] {
  return required.filter((n) => !blocks[n]);
}

export interface CodeSnippetsOptions {
  /** Folder(s) holding the Python files. All must share one parent, the repository root. */
  sourceDirs: string | string[];
  /** Folder whose TypeScript files ask for blocks. */
  stagesDir: string;
}

export function codeSnippets(options: CodeSnippetsOptions): Plugin {
  const sourceDirs = [options.sourceDirs].flat().map((d) => resolve(d));
  const stagesDir = resolve(options.stagesDir);
  const repoRoot = resolve(sourceDirs[0], '..');
  return {
    name: 'lab-code-snippets',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      let blocks: Record<string, Snippet>;
      try {
        blocks = readBlocks(sourceDirs, repoRoot);
        const missing = missingBlocks(blocks, requiredBlocks(stagesDir));
        if (missing.length > 0) {
          throw new Error(`lab code block(s) not found in the Python source: ${missing.join(', ')}`);
        }
      } catch (e) {
        this.error(`code-snippets: ${e instanceof Error ? e.message : String(e)}`);
      }
      for (const dir of sourceDirs) for (const path of listFiles(dir, '.py', false)) this.addWatchFile(path);
      for (const path of listFiles(stagesDir, '.ts', true)) this.addWatchFile(path);
      return `export const snippets = ${JSON.stringify(blocks)};\n`;
    },
  };
}
