import type { ComponentRecord, LoggerEvent } from './types.js';

export type TriageStatus =
  | 'optimized'
  | 'fixable-bail'
  | 'unsupported'
  | 'opted-out'
  | 'wont-benefit';

export interface TriageInfo {
  triageStatus: TriageStatus;
  category?: string;
  reason?: string;
  at?: { line: number };
  extraBails?: number;
  unknownCategory?: boolean;
}

export interface Locatable {
  startLine: number;
  endLine: number;
}

// Validated against babel-plugin-react-compiler@1.0.0 (all 25 categories).
export const KNOWN_CATEGORIES = new Set([
  'AutomaticEffectDependencies',
  'CapitalizedCalls',
  'Config',
  'EffectDependencies',
  'EffectDerivationsOfState',
  'EffectSetState',
  'ErrorBoundaries',
  'Factories',
  'Fire',
  'Gating',
  'Globals',
  'Hooks',
  'Immutability',
  'IncompatibleLibrary',
  'Invariant',
  'PreserveManualMemo',
  'Purity',
  'Refs',
  'RenderSetState',
  'StaticComponents',
  'Suppression',
  'Syntax',
  'Todo',
  'UnsupportedSyntax',
  'UseMemo',
]);

const COMPILER_LIMITATION = new Set(['Todo', 'UnsupportedSyntax', 'Invariant', 'IncompatibleLibrary']);

const RANK: Record<TriageStatus, number> = {
  optimized: 5,
  'fixable-bail': 4,
  unsupported: 3,
  'opted-out': 2,
  'wont-benefit': 1,
};

function readDetail(e: LoggerEvent): { category?: string; reason?: string } {
  const d = e.detail as { category?: string; reason?: string } | undefined;
  const category = d?.category;
  const reason = d?.reason ?? e.reason;
  return { category, reason: typeof reason === 'string' ? reason : reason ? String(reason) : undefined };
}

function eventLine(e: LoggerEvent): number | undefined {
  const detailLoc = (e.detail as { loc?: { start?: { line: number } } } | undefined)?.loc;
  return e.fnLoc?.start?.line ?? detailLoc?.start?.line ?? e.loc?.start?.line;
}

function statusForEvent(e: LoggerEvent): TriageStatus | null {
  switch (e.kind) {
    case 'CompileSuccess':
      return 'optimized';
    case 'CompileError':
    case 'PipelineError': {
      const { category } = readDetail(e);
      return category && COMPILER_LIMITATION.has(category) ? 'unsupported' : 'fixable-bail';
    }
    case 'CompileDiagnostic':
      return 'unsupported';
    case 'CompileSkip':
      return 'opted-out';
    default:
      return null;
  }
}

/** Classify one component from logger events in its source-line range. */
export function triageComponent<T extends Locatable>(component: T, events: LoggerEvent[]): TriageInfo {
  let best: TriageStatus = 'wont-benefit';
  let bestEvent: LoggerEvent | undefined;
  let bails = 0;

  for (const e of events) {
    const line = eventLine(e);
    if (line == null || line < component.startLine || line > component.endLine) continue;
    const s = statusForEvent(e);
    if (!s) continue;
    if (s === 'fixable-bail' || s === 'unsupported') bails++;
    if (RANK[s] > RANK[best]) {
      best = s;
      bestEvent = e;
    }
  }

  const info: TriageInfo = { triageStatus: best };
  if ((best === 'fixable-bail' || best === 'unsupported') && bestEvent) {
    const { category, reason } = readDetail(bestEvent);
    info.category = category;
    info.reason = reason;
    const line = eventLine(bestEvent);
    if (line != null) info.at = { line };
    if (bails > 1) info.extraBails = bails - 1;
    if (category && !KNOWN_CATEGORIES.has(category)) info.unknownCategory = true;
  }
  return info;
}

/** Attach triage fields to reconciled records (legacy status unchanged). */
export function applyTriage(records: ComponentRecord[], events: LoggerEvent[]): void {
  for (const r of records) {
    const info = triageComponent(r, events);
    r.triageStatus = info.triageStatus;
    r.category = info.category;
    r.triageReason = info.reason;
    r.at = info.at;
    r.extraBails = info.extraBails;
    r.unknownCategory = info.unknownCategory;
  }
}

/** Map legacy status to triage when baseline has no triage field (v1 compat). */
export function legacyStatusToTriage(status: string): TriageStatus {
  switch (status) {
    case 'optimized':
      return 'optimized';
    case 'error':
      return 'fixable-bail';
    case 'skipped':
      return 'opted-out';
    default:
      return 'wont-benefit';
  }
}
