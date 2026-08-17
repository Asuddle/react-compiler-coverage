import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCoverage, diffAgainstBaseline, toBaseline } from '../dist/index.js';

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
