import type { ComponentLocation } from './enumerate.js';
import type { LoggerEvent } from './types.js';

/** Prefer real-build success markers; keep Babel error/skip signals. */
export function mergeBuildAndBabelEvents(
  babelEvents: LoggerEvent[],
  buildEvents: LoggerEvent[],
  components: ComponentLocation[],
): LoggerEvent[] {
  if (buildEvents.length === 0) return babelEvents;

  const buildOptimizedLines = new Set(
    buildEvents.filter((e) => e.kind === 'CompileSuccess').map((e) => e.fnLoc?.start?.line),
  );

  const filteredBabel = babelEvents.filter((e) => {
    if (e.kind === 'CompileSuccess') {
      const line = e.fnLoc?.start?.line ?? e.loc?.start?.line;
      // Drop Babel-only success when build didn't confirm (SWC may differ)
      return line != null && buildOptimizedLines.has(line);
    }
    return true;
  });

  const babelLines = new Set(
    filteredBabel.map((e) => e.fnLoc?.start?.line ?? e.loc?.start?.line),
  );

  const added = buildEvents.filter((e) => {
    const line = e.fnLoc?.start?.line ?? e.loc?.start?.line;
    return line != null && !babelLines.has(line);
  });

  return [...filteredBabel, ...added];
}

export function hasBuildEvidence(buildEvents: LoggerEvent[]): boolean {
  return buildEvents.length > 0;
}
