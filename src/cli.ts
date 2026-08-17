#!/usr/bin/env node
import path from 'node:path';
import { runCoverage } from './coverage.js';
import { writeBaseline, readBaseline, diffAgainstBaseline } from './baseline.js';
import type { CoverageReport } from './types.js';

const BASELINE_FILE = '.react-compiler-coverage.json';
const ICON: Record<string, string> = { optimized: '\u2713', error: '\u2717', skipped: '\u2013', silent: '?' };

function printReport(report: CoverageReport): void {
  const cwd = process.cwd();
  console.log('\nReact Compiler Coverage');
  console.log('\u2500'.repeat(64));
  let lastFile = '';
  for (const c of report.components) {
    const rel = path.relative(cwd, c.file);
    if (rel !== lastFile) {
      console.log(`\n  ${rel}`);
      lastFile = rel;
    }
    console.log(`   ${ICON[c.status] ?? '?'} ${c.name.padEnd(24)} ${c.status.padEnd(10)} ${c.reason ? '\u00b7 ' + c.reason : ''}`);
  }
  const t = report.totals;
  console.log('\n' + '\u2500'.repeat(64));
  console.log(` Coverage: ${t.optimized}/${t.total} optimized (${report.coveragePct}%)`);
  console.log(` optimized:${t.optimized}  error:${t.error}  opt-out:${t.skipped}  silent:${t.silent}`);
  console.log('\u2500'.repeat(64) + '\n');
}

function main(): void {
  const [cmd = 'report', target = 'src'] = process.argv.slice(2);

  if (cmd === 'report') {
    printReport(runCoverage(target));
    return;
  }

  if (cmd === 'baseline') {
    const report = runCoverage(target);
    writeBaseline(report, BASELINE_FILE);
    printReport(report);
    console.log(`Baseline written to ${BASELINE_FILE}\n`);
    return;
  }

  if (cmd === 'check') {
    const report = runCoverage(target);
    printReport(report);
    const baseline = readBaseline(BASELINE_FILE);
    if (!baseline) {
      console.error(`No baseline found (${BASELINE_FILE}).`);
      console.error(`Create one with:  react-compiler-coverage baseline ${target}\n`);
      process.exit(2);
    }
    const regressions = diffAgainstBaseline(report, baseline);
    if (regressions.length > 0) {
      console.error(`\u2717 ${regressions.length} compiler regression(s) vs baseline:`);
      for (const r of regressions) console.error(`   ${r.key}: ${r.from} \u2192 ${r.to}`);
      console.error('');
      process.exit(1);
    }
    console.log('\u2713 No compiler regressions against baseline.\n');
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  console.error('Usage: react-compiler-coverage <report|baseline|check> [path]\n');
  process.exit(2);
}

main();
