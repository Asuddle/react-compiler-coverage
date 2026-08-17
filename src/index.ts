export { runCoverage, analyzeFile, walk } from './coverage.js';
export { enumerateComponents } from './enumerate.js';
export { collectEvents } from './collect.js';
export { reconcile } from './reconcile.js';
export { toBaseline, writeBaseline, readBaseline, diffAgainstBaseline } from './baseline.js';
export type { Baseline, Regression } from './baseline.js';
export type { ComponentLocation } from './enumerate.js';
export type {
  ComponentRecord,
  ComponentStatus,
  CoverageReport,
  CoverageTotals,
  LoggerEvent,
} from './types.js';
