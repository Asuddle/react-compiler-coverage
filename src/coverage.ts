import fs from 'node:fs';
import path from 'node:path';
import { enumerateComponents } from './enumerate.js';
import { collectEvents } from './collect.js';
import { collectEventsFromBuild } from './collect-build.js';
import { hasBuildEvidence, mergeBuildAndBabelEvents } from './merge-events.js';
import { reconcile } from './reconcile.js';
import { resolveCompilerPlugin } from './babel.js';
import { detectCompilerBackend, defaultBuildDir } from './compiler-backend.js';
import type { ComponentRecord, CoverageOptions, CoverageReport, CoverageTotals, SkippedFile } from './types.js';

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

export interface AnalyzeResult {
  components: ComponentRecord[];
  skipped?: SkippedFile;
}

function collectFileEvents(
  code: string,
  file: string,
  components: ReturnType<typeof enumerateComponents>,
  options?: CoverageOptions,
): import('./types.js').LoggerEvent[] {
  const babelEvents = collectEvents(code, file, options);
  const backend = options?.backend ?? detectCompilerBackend();
  const buildDir = options?.buildDir ?? (backend === 'swc' ? defaultBuildDir() : undefined);

  if (backend !== 'swc' || !buildDir) return babelEvents;

  const buildEvents = collectEventsFromBuild(file, buildDir, components);
  if (!hasBuildEvidence(buildEvents)) return babelEvents;

  return mergeBuildAndBabelEvents(babelEvents, buildEvents, components);
}

function swcWarning(options?: CoverageOptions, warnings?: string[]): void {
  const backend = options?.backend ?? detectCompilerBackend();
  if (backend !== 'swc') return;
  const buildDir = options?.buildDir ?? defaultBuildDir();
  const msg = buildDir
    ? undefined
    : 'Project uses SWC/Turbopack for the React Compiler. Run a production build and pass --build-dir .next for accurate results.';
  if (msg && warnings && !warnings.includes(msg)) warnings.push(msg);
}

/**
 * Analyze a single file into per-component records. A file that fails to
 * parse/transform yields [] but is reported to stderr — silently dropping it
 * would understate coverage without anyone noticing.
 */
export function analyzeFile(
  file: string,
  options?: CoverageOptions,
  warnings?: string[],
): AnalyzeResult {
  const code = fs.readFileSync(file, 'utf8');
  swcWarning(options, warnings);
  try {
    const locations = enumerateComponents(code, file);
    const components = reconcile(locations, collectFileEvents(code, file, locations, options));
    return { components };
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] ?? String(err) : String(err);
    console.warn(`react-compiler-coverage: skipped ${file} (${reason})`);
    return { components: [], skipped: { file, reason } };
  }
}

function dedupeRecords(components: ComponentRecord[]): ComponentRecord[] {
  const seen = new Set<string>();
  const out: ComponentRecord[] = [];
  for (const c of components) {
    const key = `${c.file}:${c.name}:${c.startLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Run coverage over a file or directory. */
export function runCoverage(target: string, options?: CoverageOptions): CoverageReport {
  resolveCompilerPlugin();
  const warnings: string[] = [];
  const files = fs.statSync(target).isDirectory() ? walk(target) : [target];
  const skippedFiles: SkippedFile[] = [];
  const components = dedupeRecords(
    files.flatMap((file) => {
      const result = analyzeFile(file, options, warnings);
      if (result.skipped) skippedFiles.push(result.skipped);
      return result.components;
    }),
  );
  const totals: CoverageTotals = { optimized: 0, error: 0, skipped: 0, silent: 0, total: components.length };
  for (const c of components) totals[c.status]++;
  const coveragePct = Math.round((totals.optimized / (components.length || 1)) * 100);
  return {
    components,
    totals,
    coveragePct,
    filesScanned: files.length,
    skippedFiles,
    warnings: [...new Set(warnings)],
    backend: options?.backend ?? detectCompilerBackend(),
  };
}
