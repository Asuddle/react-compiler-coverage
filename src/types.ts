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

export interface CoverageReport {
  components: ComponentRecord[];
  totals: CoverageTotals;
  coveragePct: number;
}
