import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCoverage, diffAgainstBaseline, toBaseline, reconcile } from '../dist/index.js';

test('buckets each component into the correct status', () => {
  const report = runCoverage('test/fixtures');
  const byName = Object.fromEntries(report.components.map((c) => [c.name, c.status]));
  assert.equal(byName.Header, 'optimized');
  assert.equal(byName.LegacyWidget, 'skipped');
  assert.equal(byName.BrokenComponent, 'error');
  assert.equal(byName.ProductCard, 'silent', 'a component with nothing to memoize must be silent, not counted as optimized');
});

test('coverage percentage reflects only optimized components', () => {
  const report = runCoverage('test/fixtures');
  assert.equal(report.totals.total, 4);
  assert.equal(report.totals.optimized, 1);
  assert.equal(report.coveragePct, 25);
});

test('parses TypeScript files instead of silently dropping them', () => {
  const report = runCoverage('test/fixtures-ts');
  const byName = Object.fromEntries(report.components.map((c) => [c.name, c.status]));
  // Before TS-preset support, the type syntax threw and the file yielded [].
  assert.equal(report.totals.total, 1, 'the .tsx component must be enumerated');
  assert.equal(byName.TypedHeader, 'optimized');
});

test('diff flags an optimized -> silent regression', () => {
  const report = runCoverage('test/fixtures');
  const baseline = toBaseline(report);
  // Pretend Header was optimized before; now simulate it going silent.
  const regressed = {
    ...report,
    components: report.components.map((c) =>
      c.name === 'Header' ? { ...c, status: 'silent' } : c
    ),
  };
  const regressions = diffAgainstBaseline(regressed, baseline);
  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].from, 'optimized');
  assert.equal(regressions[0].to, 'silent');
});

// Build a minimal report from [name, status] pairs (one synthetic file).
const reportOf = (...pairs) => ({
  coveragePct: 0,
  totals: {},
  components: pairs.map(([name, status]) => ({ file: 'f.jsx', name, status, reason: null })),
});

test('attributes an event to the narrowest enclosing component (nested)', () => {
  const comps = [
    { name: 'Outer', file: 'f.jsx', startLine: 1, endLine: 10 },
    { name: 'Inner', file: 'f.jsx', startLine: 4, endLine: 6 },
  ];
  const events = [{ kind: 'CompileSuccess', fnLoc: { start: { line: 5 } }, memoBlocks: 1 }];
  const byName = Object.fromEntries(reconcile(comps, events).map((r) => [r.name, r.status]));
  assert.equal(byName.Inner, 'optimized', 'inner (tighter range) must own the event');
  assert.equal(byName.Outer, 'silent', 'outer must not steal the nested event');
});

test('adding an opt-out to an already-silent component is NOT a regression', () => {
  const baseline = toBaseline(reportOf(['Widget', 'silent']));
  const now = reportOf(['Widget', 'skipped']);
  assert.deepEqual(diffAgainstBaseline(now, baseline), []);
});

test('a brand-new erroring component fails the gate', () => {
  const baseline = toBaseline(reportOf(['Old', 'optimized']));
  const now = reportOf(['Old', 'optimized'], ['NewBroken', 'error']);
  const regressions = diffAgainstBaseline(now, baseline);
  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].key, 'f.jsx:NewBroken');
  assert.equal(regressions[0].from, '(new)');
  assert.equal(regressions[0].to, 'error');
});

test('a brand-new silent component does NOT fail the gate', () => {
  const baseline = toBaseline(reportOf(['Old', 'optimized']));
  const now = reportOf(['Old', 'optimized'], ['NewSilent', 'silent']);
  assert.deepEqual(diffAgainstBaseline(now, baseline), []);
});
