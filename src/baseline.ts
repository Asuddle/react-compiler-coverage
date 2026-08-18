import fs from 'node:fs';
import type { CoverageReport, TriageStatus } from './types.js';
import { legacyStatusToTriage } from './triage.js';

export interface Baseline {
  /** 2 when `triage` map is present. Omitted on v1 baselines. */
  version?: 2;
  coveragePct: number | null;
  components: Record<string, string>;
  triage?: Record<string, TriageStatus>;
}

export interface Regression {
  key: string;
  from: string;
  to: string;
}

export interface BaselineDiff {
  regressions: Regression[];
  /** Non-fatal de-optimization signals (optimized → wont-benefit) on v2 baselines. */
  warnings: Regression[];
}

export interface DiffOptions {
  /**
   * Fail on any legacy-status health drop (optimized → silent/error/skipped).
   * Restores the pre-triage CI gate.
   */
  strict?: boolean;
}

const NEW = '(new)';

/** Higher rank = healthier. Pre-triage gate used this on `status` only. */
const LEGACY_RANK: Record<string, number> = { optimized: 3, silent: 2, skipped: 2, error: 0 };
const DEFAULT_LEGACY_RANK = 2;

function hasTriageMap(baseline: Baseline): boolean {
  return baseline.triage != null && Object.keys(baseline.triage).length > 0;
}

function triageForKey(
  key: string,
  statusMap: Record<string, string>,
  triageMap: Record<string, TriageStatus> | undefined,
): TriageStatus | undefined {
  if (statusMap[key] == null) return undefined;
  return triageMap?.[key] ?? legacyStatusToTriage(statusMap[key] ?? '');
}

export function toBaseline(report: CoverageReport): Baseline {
  const components: Record<string, string> = {};
  const triage: Record<string, TriageStatus> = {};
  for (const c of report.components) {
    const key = `${c.file}:${c.name}`;
    components[key] = c.status;
    if (c.triageStatus) triage[key] = c.triageStatus;
  }
  return {
    version: 2,
    coveragePct: report.coveragePct,
    components,
    triage: Object.keys(triage).length > 0 ? triage : undefined,
  };
}

export function writeBaseline(report: CoverageReport, file: string): void {
  fs.writeFileSync(file, JSON.stringify(toBaseline(report), null, 2) + '\n');
}

export function readBaseline(file: string): Baseline | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Baseline) : null;
}

function pushLegacyDrops(
  report: CoverageReport,
  baseline: Baseline,
  regressions: Regression[],
): void {
  const current = toBaseline(report).components;
  for (const [key, was] of Object.entries(baseline.components)) {
    const now = current[key];
    if (!now) continue;
    if ((LEGACY_RANK[now] ?? DEFAULT_LEGACY_RANK) < (LEGACY_RANK[was] ?? DEFAULT_LEGACY_RANK)) {
      regressions.push({ key, from: was, to: now });
    }
  }
  for (const [key, now] of Object.entries(current)) {
    if (!(key in baseline.components) && now === 'error') {
      regressions.push({ key, from: NEW, to: now });
    }
  }
}

/**
 * Compare current run to baseline.
 *
 * v1 (no `triage` map): keep the pre-triage status-rank gate. Do not invent
 * triage regressions from a baseline that never recorded triage.
 *
 * v2 (has `triage` map): fail `optimized → fixable-bail` and new fixable-bails;
 * warn on `optimized → wont-benefit`.
 *
 * `--strict`: always fail on any legacy-status health drop, even on v2.
 */
export function diffAgainstBaseline(
  report: CoverageReport,
  baseline: Baseline,
  options: DiffOptions = {},
): BaselineDiff {
  const current = toBaseline(report);
  const regressions: Regression[] = [];
  const warnings: Regression[] = [];
  const v2 = hasTriageMap(baseline);

  if (!v2 || options.strict) {
    pushLegacyDrops(report, baseline, regressions);
  }

  if (!v2) {
    return { regressions, warnings };
  }

  for (const [key, wasStatus] of Object.entries(baseline.components)) {
    const nowStatus = current.components[key];
    if (!nowStatus) continue;

    const was = triageForKey(key, baseline.components, baseline.triage) ?? legacyStatusToTriage(wasStatus);
    const now = triageForKey(key, current.components, current.triage) ?? legacyStatusToTriage(nowStatus);

    if (was === 'optimized' && now === 'fixable-bail') {
      if (!regressions.some((r) => r.key === key && r.to === now)) {
        regressions.push({ key, from: was, to: now });
      }
    } else if (was === 'optimized' && now === 'wont-benefit') {
      if (options.strict) {
        if (!regressions.some((r) => r.key === key)) {
          regressions.push({ key, from: wasStatus, to: nowStatus });
        }
      } else {
        warnings.push({ key, from: was, to: now });
      }
    }
  }

  for (const [key, nowStatus] of Object.entries(current.components)) {
    if (key in baseline.components) continue;
    const now = triageForKey(key, current.components, current.triage) ?? legacyStatusToTriage(nowStatus);
    if (now === 'fixable-bail' && !regressions.some((r) => r.key === key)) {
      regressions.push({ key, from: NEW, to: now });
    }
  }

  return { regressions, warnings };
}
