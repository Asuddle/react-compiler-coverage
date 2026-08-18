#!/usr/bin/env node
import path from 'node:path';
import { runCoverage } from './coverage.js';
import { writeBaseline, readBaseline, diffAgainstBaseline } from './baseline.js';
import type { ComponentRecord, CoverageOptions, CoverageReport } from './types.js';

const BASELINE_FILE = '.react-compiler-coverage.json';
const ICON: Record<string, string> = {
  optimized: '\u2713',
  error: '\u2717',
  skipped: '\u2013',
  silent: '\u00b7',
};
const TRIAGE_ICON: Record<string, string> = {
  optimized: '\u2713',
  'fixable-bail': '\u2717',
  unsupported: '~',
  'opted-out': '\u2013',
  'wont-benefit': '\u00b7',
};

interface CliArgs {
  cmd: string;
  target: string;
  options: CoverageOptions;
  allowSkipped: boolean;
  strict: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const allowSkipped = argv.includes('--allow-skipped');
  const strict = argv.includes('--strict');
  const options: CoverageOptions = { allowUnavailable: argv.includes('--allow-unavailable') };
  const filtered: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--allow-skipped' || arg === '--allow-unavailable' || arg === '--strict') continue;
    if (arg === '--config') {
      options.config = argv[++i];
      continue;
    }
    if (arg === '--build-dir') {
      options.buildDir = argv[++i];
      continue;
    }
    filtered.push(arg ?? '');
  }
  const [cmd = 'report', target = 'src'] = filtered;
  return { cmd, target, options, allowSkipped, strict };
}

function displayLabel(c: ComponentRecord): string {
  if (c.triageStatus === 'wont-benefit') return 'wont-benefit (certified fine)';
  if (c.triageStatus) return c.triageStatus;
  return c.status;
}

function displayReason(c: ComponentRecord): string {
  const parts: string[] = [];
  if (c.triageReason) parts.push(c.triageReason);
  else if (c.reason) parts.push(c.reason);
  if (c.category) {
    const cat =
      c.category === 'PreserveManualMemo'
        ? `PreserveManualMemo — remove manual memoization so the compiler can optimize`
        : c.category;
    parts.unshift(cat);
  }
  if (c.unknownCategory) parts.push('(unknown category — compiler version drift?)');
  return parts.join(' \u00b7 ');
}

function printTriageSummary(report: CoverageReport, cwd: string): void {
  const t = report.triage;
  if (!t) return;

  console.log('\n Triage (isolated Babel logger — see docs/silent-diagnosis-design.md)');
  if (report.backend === 'swc') {
    console.log('   Note: triage reflects the tool\u2019s Babel pass, not the production SWC bundle.');
  }
  console.log(
    `   certified fine (wont-benefit): ${t.wontBenefit}  ` +
      `fixable bails: ${t.fixableBail}  unsupported: ${t.unsupported}  opted-out: ${t.optedOut}`,
  );

  const categories = Object.entries(t.bailByCategory).sort((a, b) => b[1] - a[1]);
  if (categories.length === 0) return;

  console.log('\n Fixable bails by category:');
  for (const [cat, count] of categories) {
    const highlight = cat === 'PreserveManualMemo' ? ' \u2190 remove manual memo to unlock optimization' : '';
    console.log(`   ${cat.padEnd(22)} ${count}${highlight}`);
  }

  const fixable = report.components.filter((c) => c.triageStatus === 'fixable-bail');
  if (fixable.length === 0) return;

  console.log('\n Fixable bails (action required):');
  let lastFile = '';
  for (const c of fixable) {
    const rel = path.relative(cwd, c.file);
    if (rel !== lastFile) {
      console.log(`\n   ${rel}`);
      lastFile = rel;
    }
    const loc = c.at?.line != null ? `:${c.at.line}` : '';
    console.log(`    \u2717 ${c.name}${loc}  ${displayReason(c)}`);
  }
}

function printReport(report: CoverageReport): void {
  const cwd = process.cwd();
  console.log('\nReact Compiler Coverage');
  if (report.backend !== 'unknown') {
    console.log(` Compiler backend: ${report.backend}`);
  }
  if (!report.coverageAvailable) {
    console.log(' Coverage: UNAVAILABLE (see warnings below)');
  }
  console.log('\u2500'.repeat(64));

  const showTriage = report.triage != null;
  let lastFile = '';
  for (const c of report.components) {
    const rel = path.relative(cwd, c.file);
    if (rel !== lastFile) {
      console.log(`\n  ${rel}`);
      lastFile = rel;
    }
    const icon = showTriage && c.triageStatus ? (TRIAGE_ICON[c.triageStatus] ?? '?') : (ICON[c.status] ?? '?');
    const label = showTriage && c.triageStatus ? displayLabel(c) : c.status;
    const reason =
      showTriage && c.triageStatus && c.triageStatus !== 'wont-benefit' && c.triageStatus !== 'optimized'
        ? displayReason(c)
        : c.reason
          ? c.reason
          : '';
    console.log(`   ${icon} ${c.name.padEnd(24)} ${label.padEnd(28)} ${reason ? '\u00b7 ' + reason : ''}`);
  }

  const totals = report.totals;
  console.log('\n' + '\u2500'.repeat(64));
  if (report.coverageAvailable && report.coveragePct != null) {
    console.log(` ${report.coverageLabel}: ${totals.optimized}/${totals.total} optimized (${report.coveragePct}%)`);
  } else {
    console.log(` Components: ${report.components.length} enumerated (${report.coverageLabel})`);
  }
  console.log(` optimized:${totals.optimized}  error:${totals.error}  opt-out:${totals.skipped}  silent:${totals.silent}`);

  printTriageSummary(report, cwd);

  if (report.skippedFiles.length > 0) {
    console.log(`\n Skipped files: ${report.skippedFiles.length}/${report.filesScanned} (not counted in coverage)`);
    for (const s of report.skippedFiles) {
      console.log(`   ${path.relative(cwd, s.file)}  \u00b7 ${s.reason}`);
    }
  }
  if (report.warnings.length > 0) {
    console.log('\n Warnings:');
    for (const w of report.warnings) console.log(`   \u00b7 ${w}`);
  }
  if (totals.total === 0 && report.filesScanned > 0 && report.skippedFiles.length === 0) {
    console.log('\n No components found in scanned files.');
  } else if (totals.total === 0 && report.filesScanned === 0) {
    console.log('\n No source files found in target path.');
  }
  console.log('\u2500'.repeat(64) + '\n');
}

function gateExitCode(
  report: CoverageReport,
  allowSkipped: boolean,
  allowUnavailable: boolean,
): number | undefined {
  if (!report.coverageAvailable && !allowUnavailable) return 3;
  if (report.totals.total === 0) return 2;
  if (!allowSkipped && report.skippedFiles.length > 0) return 1;
  return undefined;
}

function main(): void {
  const { cmd, target, options, allowSkipped, strict } = parseArgs(process.argv.slice(2));

  if (cmd === 'report') {
    const report = runCoverage(target, options);
    printReport(report);
    const gate = gateExitCode(report, allowSkipped, options.allowUnavailable ?? false);
    if (gate === 3) process.exit(3);
    return;
  }

  if (cmd === 'baseline') {
    const report = runCoverage(target, options);
    const gate = gateExitCode(report, allowSkipped, options.allowUnavailable ?? false);
    if (gate != null) process.exit(gate);
    writeBaseline(report, BASELINE_FILE);
    printReport(report);
    console.log(`Baseline written to ${BASELINE_FILE}\n`);
    return;
  }

  if (cmd === 'check') {
    const report = runCoverage(target, options);
    printReport(report);
    const gate = gateExitCode(report, allowSkipped, options.allowUnavailable ?? false);
    if (gate != null) {
      if (gate === 3) {
        console.error('\u2717 Coverage unavailable — SWC build scan required (unminified --build-dir).\n');
      } else if (gate === 2) {
        console.error('\u2717 No components found — check the target path or fix parse errors.\n');
      } else {
        console.error('\u2717 Files were skipped during analysis — coverage count may be understated.\n');
      }
      process.exit(gate);
    }
    const baseline = readBaseline(BASELINE_FILE);
    if (!baseline) {
      console.error(`No baseline found (${BASELINE_FILE}).`);
      console.error(`Create one with:  react-compiler-coverage baseline ${target}\n`);
      process.exit(2);
    }
    const { regressions, warnings } = diffAgainstBaseline(report, baseline, { strict });
    if (warnings.length > 0) {
      console.warn(`\u26a0 ${warnings.length} possible de-optimization(s) vs baseline (not failing CI):`);
      for (const w of warnings) console.warn(`   ${w.key}: ${w.from} \u2192 ${w.to}`);
      console.warn('');
    }
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
  console.error(
    'Usage: react-compiler-coverage <report|baseline|check> [path] [--config file.json] [--build-dir .next] [--allow-skipped] [--allow-unavailable] [--strict]\n',
  );
  process.exit(2);
}

try {
  main();
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
}
