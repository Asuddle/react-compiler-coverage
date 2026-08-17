import fs from 'node:fs';
import type { CoverageReport } from './types.js';

export interface Baseline {
  coveragePct: number;
  components: Record<string, string>;
}

export interface Regression {
  key: string;
  from: string;
  to: string;
}

// Higher rank = healthier. A drop in rank between runs is a regression.
const RANK: Record<string, number> = { optimized: 3, silent: 2, skipped: 1, error: 0 };

export function toBaseline(report: CoverageReport): Baseline {
  const components: Record<string, string> = {};
  for (const c of report.components) components[`${c.file}:${c.name}`] = c.status;
  return { coveragePct: report.coveragePct, components };
}

export function writeBaseline(report: CoverageReport, file: string): void {
  fs.writeFileSync(file, JSON.stringify(toBaseline(report), null, 2) + '\n');
}

export function readBaseline(file: string): Baseline | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Baseline) : null;
}

/** Report only components that got WORSE vs the baseline. New/removed are ignored. */
export function diffAgainstBaseline(report: CoverageReport, baseline: Baseline): Regression[] {
  const current = toBaseline(report).components;
  const regressions: Regression[] = [];
  for (const [key, was] of Object.entries(baseline.components)) {
    const now = current[key];
    if (!now) continue;
    if ((RANK[now] ?? 2) < (RANK[was] ?? 2)) regressions.push({ key, from: was, to: now });
  }
  return regressions;
}
