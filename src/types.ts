export type ComponentStatus = 'optimized' | 'error' | 'skipped' | 'silent';

export interface ComponentRecord {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  status: ComponentStatus;
  reason: string | null;
  memoBlocks?: number;
}

export interface LoggerEvent {
  kind: string;
  fnName?: string | null;
  fnLoc?: { start?: { line: number }; end?: { line: number } } | null;
  loc?: { start?: { line: number } } | null;
  reason?: string;
  detail?: unknown;
  memoBlocks?: number;
  memoValues?: number;
  memoSlots?: number;
}

export interface CoverageTotals {
  optimized: number;
  error: number;
  skipped: number;
  silent: number;
  total: number;
}

export interface SkippedFile {
  file: string;
  reason: string;
}

export type CompilerBackend = 'babel' | 'swc' | 'unknown';

export type BuildBundler = 'webpack' | 'turbopack' | 'unknown';

export interface CoverageOptions {
  /** Path to a JSON file with React Compiler plugin options. */
  config?: string;
  /** Inline compiler plugin options (overrides project config). */
  compilerOptions?: Record<string, unknown>;
  /** Build output dir for SWC/Turbopack verification (.next, dist, build). */
  buildDir?: string;
  /** Force compiler backend detection (default: auto). */
  backend?: CompilerBackend;
  /** Allow reporting on SWC when build scan is unavailable (not recommended). */
  allowUnavailable?: boolean;
}

export interface CoverageReport {
  components: ComponentRecord[];
  totals: CoverageTotals;
  /** null when coverageAvailable is false — do not show a percentage. */
  coveragePct: number | null;
  /** False on SWC when build-dir scan is missing or unreliable (minified). */
  coverageAvailable: boolean;
  /** Human label for what the % measures (e.g. client-component SWC coverage). */
  coverageLabel: string;
  buildBundler: BuildBundler;
  filesScanned: number;
  skippedFiles: SkippedFile[];
  warnings: string[];
  backend: CompilerBackend;
}
