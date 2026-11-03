import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeSnippets, extractBlocks, missingBlocks, readBlocks, requiredBlocks } from './code-snippets';

function project(files: Record<string, string>, stages: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'lab-snippets-'));
  mkdirSync(join(root, 'training'));
  mkdirSync(join(root, 'stages'));
  for (const [n, t] of Object.entries(files)) writeFileSync(join(root, 'training', n), t);
  for (const [n, t] of Object.entries(stages)) writeFileSync(join(root, 'stages', n), t);
  return { root, training: join(root, 'training'), stages: join(root, 'stages') };
}

const PY = ['import numpy as np', '', '# lab:one', 'def one(x):', '    return x', '# endlab', '', 'two = 2'].join('\n');

describe('extractBlocks', () => {
  it('returns the lines between the markers, with their position in the file', () => {
    const [b] = extractBlocks(PY, 'training/a.py');
    expect(b).toEqual({ name: 'one', file: 'training/a.py', startLine: 4, lines: ['def one(x):', '    return x'] });
  });

  it('accepts Windows line endings and ignores trailing spaces', () => {
    const [b] = extractBlocks('# lab:a\r\nx = 1   \r\n# endlab\r\n', 'f.py');
    expect(b.lines).toEqual(['x = 1']);
  });

  it('rejects a block that is never closed, nested, repeated or closed without a start', () => {
    expect(() => extractBlocks('# lab:a\nx = 1\n', 'f.py')).toThrow(/never closed/);
    expect(() => extractBlocks('# lab:a\n# lab:b\n# endlab\n# endlab\n', 'f.py')).toThrow(/starts inside/);
    expect(() => extractBlocks('# lab:a\n# endlab\n# lab:a\n# endlab\n', 'f.py')).toThrow(/twice/);
    expect(() => extractBlocks('x = 1\n# endlab\n', 'f.py')).toThrow(/without a block/);
  });
});

describe('readBlocks', () => {
  it('collects blocks from every Python file and rejects a name used in two files', () => {
    const p = project({ 'a.py': PY, 'b.py': '# lab:other\ny = 2\n# endlab\n' }, {});
    expect(Object.keys(readBlocks(p.training, p.root)).sort()).toEqual(['one', 'other']);
    const q = project({ 'a.py': PY, 'b.py': PY }, {});
    expect(() => readBlocks(q.training, q.root)).toThrow(/in both/);
  });
});

describe('requiredBlocks', () => {
  it('finds every lab(name) call under the stages folder, including subfolders', () => {
    const p = project({}, { 'a.ts': "code: [lab('one'), lab( 'two' )]", 'b.ts': "const s = lab('three');" });
    mkdirSync(join(p.stages, 'deep'));
    writeFileSync(join(p.stages, 'deep', 'c.ts'), "lab('four')");
    expect(requiredBlocks(p.stages)).toEqual(['four', 'one', 'three', 'two']);
  });
});

describe('the plugin', () => {
  type LoadContext = { error: (m: string) => never; addWatchFile: (f: string) => void };
  const ctx: LoadContext = {
    error: (m) => {
      throw new Error(m);
    },
    addWatchFile: () => {},
  };
  const load = (p: ReturnType<typeof project>) => {
    const plugin = codeSnippets({ sourceDirs: p.training, stagesDir: p.stages });
    const fn = plugin.load as (this: LoadContext, id: string) => string | null;
    return fn.call(ctx, '\0virtual:lab-snippets');
  };

  it('resolves only its own module', () => {
    const p = project({ 'a.py': PY }, {});
    const plugin = codeSnippets({ sourceDirs: p.training, stagesDir: p.stages });
    const resolveId = plugin.resolveId as (id: string) => string | null;
    expect(resolveId('virtual:lab-snippets')).toBe('\0virtual:lab-snippets');
    expect(resolveId('react')).toBeNull();
  });

  it('exports the blocks as a module', () => {
    const p = project({ 'a.py': PY }, { 'a.ts': "lab('one')" });
    const code = load(p)!;
    expect(code).toMatch(/^export const snippets = /);
    expect(JSON.parse(code.replace(/^export const snippets = /, '').replace(/;\s*$/, '')).one.lines).toEqual([
      'def one(x):',
      '    return x',
    ]);
  });

  it('fails the build when a named block is missing', () => {
    const p = project({ 'a.py': PY }, { 'a.ts': "lab('one'); lab('missing_block')" });
    expect(() => load(p)).toThrow(/missing_block/);
    expect(missingBlocks(readBlocks(p.training, p.root), ['one', 'missing_block'])).toEqual(['missing_block']);
  });
});

describe('several source folders and a missing stages folder', () => {
  it('reads blocks from every source folder and tolerates a stages folder that does not exist yet', () => {
    const root = mkdtempSync(join(tmpdir(), 'snip-multi-'));
    mkdirSync(join(root, 'training'));
    mkdirSync(join(root, 'pipeline'));
    writeFileSync(join(root, 'training', 'a.py'), '# lab:alpha\nx = 1\n# endlab\n');
    writeFileSync(join(root, 'pipeline', 'b.py'), '# lab:beta\ny = 2\n# endlab\n');
    const blocks = readBlocks([join(root, 'training'), join(root, 'pipeline')], root);
    expect(Object.keys(blocks).sort()).toEqual(['alpha', 'beta']);
    expect(blocks.beta.file).toBe('pipeline/b.py');
    expect(requiredBlocks(join(root, 'no-such-stages'))).toEqual([]);
  });
});
