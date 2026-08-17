import fs from 'node:fs';
import path from 'node:path';

const EXT = /\.(jsx?|tsx?|mjs|cjs)$/;

/** Resolve a relative import/export source to an absolute source file path. */
export function resolveSourceModule(fromFile: string, source: string): string | undefined {
  if (!source.startsWith('.')) return undefined;
  const base = path.resolve(path.dirname(fromFile), source);
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, 'index.tsx'),
    path.join(base, 'index.ts'),
    path.join(base, 'index.jsx'),
    path.join(base, 'index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile() && EXT.test(c)) return c;
  }
  return undefined;
}
