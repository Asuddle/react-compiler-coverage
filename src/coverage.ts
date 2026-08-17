import fs from 'node:fs';
import path from 'node:path';
import { enumerateComponents } from './enumerate.js';
import { collectEvents } from './collect.js';
import { scanBuildOutput, detectBuildBundler } from './collect-build.js';
import { mergeBuildAndBabelEvents } from './merge-events.js';
import { reconcile } from './reconcile.js';
import { resolveCompilerPlugin } from './babel.js';
import { detectCompilerBackend, defaultBuildDir, loadProjectConfigWarnings } from './compiler-backend.js';
import { resolveCompilerOptionsWithWarnings } from './compiler-config.js';
import type { ComponentRecord, CoverageOptions, CoverageReport, CoverageTotals, LoggerEvent, SkippedFile } from './types.js';

const EXT = /\.(jsx?|tsx?)$/;
const IGNORE = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'coverage']);

const SWC_NO_BUILD_DIR =
  'Coverage unavailable: this project compiles with SWC/Turbopack, which does not expose ' +
  'babel-plugin-react-compiler logger events. Pass --build-dir after an unminified build ' +
  '(next build with minification disabled). Without it, no per-component coverage number is reported.';

const SWC_UNRELIABLE_BUILD =
  'Coverage unavailable: build output is minified or lacks readable component names. ' +
  'Rebuild unminified — the compiler made the same memoization decisions; only labels were stripped.';

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
  /** SWC build scan was reliable for this file (undefined on Babel projects). */
  buildReliable?: boolean;
}

interface FileEventResult {
  events: LoggerEvent[];
  buildReliable: boolean;
  warnings: string[];
}

function collectFileEvents(
  code: string,
  file: string,
  components: ReturnType<typeof enumerateComponents>,
  options?: CoverageOptions,
): FileEventResult {
  const backend = options?.backend ?? detectCompilerBackend();
  const warnings: string[] = [];

  if (backend !== 'swc') {
    return { events: collectEvents(code, file, options), buildReliable: true, warnings };
  }

  const buildDir = options?.buildDir ?? defaultBuildDir();
  if (!buildDir) {
    warnings.push(SWC_NO_BUILD_DIR);
    return { events: [], buildReliable: false, warnings };
  }

  const scan = scanBuildOutput(file, buildDir, components);
  warnings.push(...scan.warnings);

  if (!scan.reliable) {
    warnings.push(SWC_UNRELIABLE_BUILD);
    return { events: [], buildReliable: false, warnings };
  }

  const babelEvents = collectEvents(code, file, options);
  const diagnosticEvents = babelEvents.filter((e) => e.kind !== 'CompileSuccess');
  const events = mergeBuildAndBabelEvents(diagnosticEvents, scan.events, components);

  return { events, buildReliable: true, warnings };
}

/**
 * Analyze a single file into per-component records.
 */
export function analyzeFile(
  file: string,
  options?: CoverageOptions,
  warnings?: string[],
): AnalyzeResult {
  const code = fs.readFileSync(file, 'utf8');
  try {
    const locations = enumerateComponents(code, file);
    const { events, buildReliable, warnings: fileWarnings } = collectFileEvents(
      code,
      file,
      locations,
      options,
    );
    if (warnings) warnings.push(...fileWarnings);
    return {
      components: reconcile(locations, events),
      buildReliable,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] ?? String(err) : String(err);
    console.warn(`react-compiler-coverage: skipped ${file} (${reason})`);
    return { components: [], skipped: { file, reason }, buildReliable: false };
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
  const warnings: string[] = [...resolveCompilerOptionsWithWarnings(options?.config, options?.compilerOptions).warnings];
  warnings.push(...loadProjectConfigWarnings());

  const files = fs.statSync(target).isDirectory() ? walk(target) : [target];
  const skippedFiles: SkippedFile[] = [];
  const fileResults: { file: string; result: AnalyzeResult }[] = [];
  const backend = options?.backend ?? detectCompilerBackend();

  for (const file of files) {
    const result = analyzeFile(file, options, warnings);
    fileResults.push({ file: path.resolve(file), result });
    if (result.skipped) skippedFiles.push(result.skipped);
  }

  const components = dedupeRecords(fileResults.flatMap(({ result }) => result.components));

  const reliableFiles = new Set(
    fileResults.filter(({ result }) => result.buildReliable === true).map(({ file }) => file),
  );
  const counted =
    backend === 'swc'
      ? components.filter((c) => reliableFiles.has(path.resolve(c.file)))
      : components;

  const totals: CoverageTotals = { optimized: 0, error: 0, skipped: 0, silent: 0, total: counted.length };
  for (const c of counted) totals[c.status]++;

  const coverageAvailable =
    backend !== 'swc' || fileResults.some(({ result }) => result.buildReliable === true);

  if (backend === 'swc' && coverageAvailable && counted.length < components.length) {
    warnings.push(
      `${components.length - counted.length} component(s) excluded — no reliable build markers ` +
        `(common for Server Components without client memo slots).`,
    );
  }

  const coveragePct = coverageAvailable
    ? Math.round((totals.optimized / (counted.length || 1)) * 100)
    : null;

  const buildBundler =
    options?.buildDir != null
      ? detectBuildBundler(options.buildDir)
      : backend === 'swc' && defaultBuildDir()
        ? detectBuildBundler(defaultBuildDir()!)
        : 'unknown';

  const coverageLabel =
    backend === 'swc'
      ? `client-component coverage (SWC · ${buildBundler})`
      : backend === 'babel'
        ? 'component coverage (Babel)'
        : 'component coverage';

  return {
    components,
    totals,
    coveragePct,
    coverageAvailable,
    coverageLabel,
    buildBundler,
    filesScanned: files.length,
    skippedFiles,
    warnings: [...new Set(warnings)],
    backend: options?.backend ?? detectCompilerBackend(),
  };
}
