import type { ComponentRecord, LoggerEvent } from './types.js';
import type { ComponentLocation } from './enumerate.js';

function extractReason(detail: unknown): string {
  if (!detail) return 'compile error';
  if (typeof detail === 'string') return detail.split('.')[0] ?? detail;
  const d = detail as Record<string, unknown>;
  // `severity` is a level ("Error"), not a human message — don't use it as one.
  const msg = (d.reason ?? d.description ?? d.message ?? '') as string;
  return String(msg).split('.')[0] || 'compile error';
}

/**
 * Attribute each logger event to the component whose source-line range contains
 * it, producing one status per enumerated component. Components with no event
 * remain 'silent' — the compiler processed them but optimized nothing.
 */
export function reconcile(comps: ComponentLocation[], events: LoggerEvent[]): ComponentRecord[] {
  const records: ComponentRecord[] = comps.map((c) => ({ ...c, status: 'silent', reason: null }));
  // Attribute to the NARROWEST enclosing component. A component defined inside
  // another (or a hook inside a component) shares the outer line range, so the
  // first match would misattribute the event to the outer one.
  const owner = (line?: number) => {
    if (line == null) return undefined;
    let best: ComponentRecord | undefined;
    for (const r of records) {
      if (line < r.startLine || line > r.endLine) continue;
      if (!best || r.endLine - r.startLine < best.endLine - best.startLine) best = r;
    }
    return best;
  };

  for (const e of events) {
    const line = e.fnLoc?.start?.line ?? e.loc?.start?.line;
    const rec = owner(line);
    if (!rec) continue;
    switch (e.kind) {
      case 'CompileSuccess':
        rec.status = 'optimized';
        rec.memoBlocks = e.memoBlocks;
        break;
      case 'CompileError':
      case 'PipelineError':
        rec.status = 'error';
        rec.reason = extractReason(e.detail);
        break;
      case 'CompileSkip':
        rec.status = 'skipped';
        rec.reason =
          !e.reason || e.reason.includes('[object Object]')
            ? "'use no memo' opt-out"
            : e.reason;
        break;
      default:
        break;
    }
  }
  return records;
}
