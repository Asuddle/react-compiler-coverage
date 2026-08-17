export { runCoverage, analyzeFile, walk } from './coverage.js';
export { enumerateComponents, enumerateModule } from './enumerate.js';
export { collectEvents } from './collect.js';
export { collectEventsFromBuild, scanBuildOutput, isMinifiedChunk, hasCompilerMarkers, hasSwcMemoCacheCall, hasBuildEvidence, detectBuildBundler } from './collect-build.js';
export type { BuildScanResult } from './collect-build.js';
export { detectCompilerBackend, defaultBuildDir } from './compiler-backend.js';
export { loadNextConfig, parseReactCompilerFromSource } from './next-config.js';
export { reconcile } from './reconcile.js';
export { resolveCompilerOptions, setCompilerOptions } from './compiler-config.js';
export { toBaseline, writeBaseline, readBaseline, diffAgainstBaseline } from './baseline.js';
export type { Baseline, Regression } from './baseline.js';
export type { ComponentLocation } from './enumerate.js';
export type {
  BuildBundler,
  CompilerBackend,
  ComponentRecord,
  ComponentStatus,
  CoverageOptions,
  CoverageReport,
  CoverageTotals,
  LoggerEvent,
  SkippedFile,
} from './types.js';
