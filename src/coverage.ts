import fs from 'node:fs';
import path from 'node:path';
import { enumerateComponents } from './enumerate.js';
import { collectEvents } from './collect.js';
import { reconcile } from './reconcile.js';
import type { ComponentRecord, CoverageReport, CoverageTotals } from './types.js';

const EXT = /\.(jsx?|tsx?)$/;
const IGNORE = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'coverage']);

/** Recursively collect source files, skipping build/vendor dirs. */
export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE.has(entry.name) && !entry.name.startsWith('.')) out.push(...walk(full));
    } else if (EXT.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Analyze a single file into per-component records. A file that fails to
 * parse/transform yields [] but is reported to stderr — silently dropping it
 * would understate coverage without anyone noticing.
 */
export function analyzeFile(file: string): ComponentRecord[] {
  const code = fs.readFileSync(file, 'utf8');
  try {
    return reconcile(enumerateComponents(code, file), collectEvents(code, file));
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    console.warn(`react-compiler-coverage: skipped ${file} (${msg})`);
    return [];
  }
}

/** Run coverage over a file or directory. */
export function runCoverage(target: string): CoverageReport {
  const files = fs.statSync(target).isDirectory() ? walk(target) : [target];
  const components = files.flatMap(analyzeFile);
  const totals: CoverageTotals = { optimized: 0, error: 0, skipped: 0, silent: 0, total: components.length };
  for (const c of components) totals[c.status]++;
  const coveragePct = Math.round((totals.optimized / (components.length || 1)) * 100);
  return { components, totals, coveragePct };
}
