import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runCoverage,
  diffAgainstBaseline,
  toBaseline,
  reconcile,
  parseReactCompilerFromSource,
  loadNextConfig,
} from '../dist/index.js';

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

test('enumerates memo, forwardRef, and class components', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-enum-'));
  fs.writeFileSync(
    path.join(dir, 'patterns.jsx'),
    `import { memo, forwardRef, Component } from 'react';
export const Memoized = memo(function Memoized({ v }) { return <span>{v}</span>; });
export const FwdInput = forwardRef(function FwdInput(props, ref) { return <input ref={ref} {...props}/>; });
export class ClassWidget extends Component { render() { return <div/>; } }`,
  );
  const report = runCoverage(dir);
  const names = new Set(report.components.map((c) => c.name));
  assert.equal(names.size, 3);
  assert.ok(names.has('Memoized'));
  assert.ok(names.has('FwdInput'));
  assert.ok(names.has('ClassWidget'));
});

test('enumerates memo with separate impl function and multiline wrapper', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-memo-'));
  fs.writeFileSync(
    path.join(dir, 'memo.jsx'),
    `import { memo } from 'react';
function MemoizedImpl({ v }) { return <span>{v}</span>; }
export const Memoized = memo(MemoizedImpl);
export const Wrapped = memo(
  function Inner({ x }) { return <div>{x}</div>; },
);`,
  );
  const report = runCoverage(dir);
  const names = new Set(report.components.map((c) => c.name));
  assert.ok(names.has('Memoized'));
  assert.ok(names.has('Wrapped'));
});

test('follows barrel re-exports to component definitions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-barrel-'));
  fs.writeFileSync(
    path.join(dir, 'Button.jsx'),
    `export function Button() { return <button/>; }`,
  );
  fs.writeFileSync(
    path.join(dir, 'index.js'),
    `export { Button } from './Button';
export { default as Card } from './Card';`,
  );
  fs.writeFileSync(
    path.join(dir, 'Card.jsx'),
    `export default function Card() { return <div/>; }`,
  );
  const report = runCoverage(path.join(dir, 'index.js'));
  const names = new Set(report.components.map((c) => c.name));
  assert.ok(names.has('Button'));
  assert.ok(names.has('Card'));
});

test('annotation mode marks unannotated components silent', () => {
  const defaultReport = runCoverage('test/fixtures');
  const annotatedReport = runCoverage('test/fixtures', {
    compilerOptions: { compilationMode: 'annotation' },
  });
  const defaultByName = Object.fromEntries(defaultReport.components.map((c) => [c.name, c.status]));
  const annotatedByName = Object.fromEntries(annotatedReport.components.map((c) => [c.name, c.status]));
  assert.equal(defaultByName.Header, 'optimized');
  assert.equal(annotatedByName.Header, 'silent', 'annotation mode skips unannotated components');
});

test('tracks skipped parse failures in skippedFiles', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-skip-'));
  fs.writeFileSync(path.join(dir, 'bad.jsx'), 'export function Bad( { return <div/>; }');
  const report = runCoverage(dir);
  assert.equal(report.skippedFiles.length, 1);
  assert.equal(report.totals.total, 0);
});

test('parses reactCompiler options from next.config.ts source', () => {
  const opts = parseReactCompilerFromSource(`
    import type { NextConfig } from 'next';
    const config: NextConfig = {
      reactCompiler: { compilationMode: 'annotation' },
    };
    export default config;
  `);
  assert.deepEqual(opts, { compilationMode: 'annotation' });
});

test('loadNextConfig reads next.config.ts via source fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-next-'));
  fs.writeFileSync(
    path.join(dir, 'next.config.ts'),
    `const config = { reactCompiler: true };
export default config;`,
  );
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    assert.deepEqual(loadNextConfig(dir), {});
  } finally {
    process.chdir(cwd);
  }
});

test('SWC build-dir output marks compiled components optimized', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-swc-'));
  const src = path.join(dir, 'Header.jsx');
  fs.writeFileSync(
    src,
    `export function Header({ title }) {
  const upper = title.toUpperCase();
  return <h1>{upper}</h1>;
}`,
  );
  const buildDir = path.join(dir, '.next');
  fs.mkdirSync(path.join(buildDir, 'static', 'chunks'), { recursive: true });
  fs.writeFileSync(
    path.join(buildDir, 'static', 'chunks', 'page.js'),
    `// ${src.replace(/\\/g, '/')}
function Header(props) {
  var upper = _c(0, function () { return props.title.toUpperCase(); });
  return _c(1, function () { return upper; }, [upper]);
}
import "react/compiler-runtime";`,
  );

  const report = runCoverage(src, { backend: 'swc', buildDir });
  const header = report.components.find((c) => c.name === 'Header');
  assert.equal(header?.status, 'optimized');
});
