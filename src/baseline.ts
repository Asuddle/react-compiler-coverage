import fs from 'node:fs';
import type { CoverageReport } from './types.js';

export interface Baseline {
  coveragePct: number | null;
  components: Record<string, string>;
}

export interface Regression {
  key: string;
  from: string;
  to: string;
}

// Higher rank = healthier. A drop in rank between runs is a regression.
// `silent` and `skipped` share a rank: neither is optimized, but an explicit
// `'use no memo'` opt-out is a deliberate, reviewed choice — no less healthy
// than a component the compiler simply optimized nothing on. So adding an
// opt-out to an already-silent component is not a regression, while losing
// optimization (optimized -> silent/skipped) still is.
const RANK: Record<string, number> = { optimized: 3, silent: 2, skipped: 2, error: 0 };
const DEFAULT_RANK = 2;

// Sentinel `from` value for a component that did not exist in the baseline.
const NEW = '(new)';

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

/**
 * Report components that got WORSE vs the baseline. Two cases fail the gate:
 *   1. An existing component dropped in health (e.g. optimized -> silent).
 *   2. A component that is NEW since the baseline was introduced in an `error`
 *      state — a Rules-of-React violation is unambiguously broken regardless of
 *      history, and adding new code is exactly what a PR does.
 * New `silent`/`skipped` components are not failed: they are common and often
 * legitimate, so gating on them would be too noisy to live with. Removed
 * components are ignored.
 */
export function diffAgainstBaseline(report: CoverageReport, baseline: Baseline): Regression[] {
  const current = toBaseline(report).components;
  const regressions: Regression[] = [];
  for (const [key, was] of Object.entries(baseline.components)) {
    const now = current[key];
    if (!now) continue;
    if ((RANK[now] ?? DEFAULT_RANK) < (RANK[was] ?? DEFAULT_RANK)) {
      regressions.push({ key, from: was, to: now });
    }
  }
  for (const [key, now] of Object.entries(current)) {
    if (!(key in baseline.components) && now === 'error') {
      regressions.push({ key, from: NEW, to: now });
    }
  }
  return regressions;
}
