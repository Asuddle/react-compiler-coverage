#!/usr/bin/env node
import path from 'node:path';
import { runCoverage } from './coverage.js';
import { writeBaseline, readBaseline, diffAgainstBaseline } from './baseline.js';
import type { CoverageOptions, CoverageReport } from './types.js';

const BASELINE_FILE = '.react-compiler-coverage.json';
const ICON: Record<string, string> = { optimized: '\u2713', error: '\u2717', skipped: '\u2013', silent: '?' };

interface CliArgs {
  cmd: string;
  target: string;
  options: CoverageOptions;
  allowSkipped: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const allowSkipped = argv.includes('--allow-skipped');
  const filtered: string[] = [];
  const options: CoverageOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--allow-skipped') continue;
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
  return { cmd, target, options, allowSkipped };
}

function printReport(report: CoverageReport): void {
  const cwd = process.cwd();
  console.log('\nReact Compiler Coverage');
  if (report.backend !== 'unknown') {
    console.log(` Compiler backend: ${report.backend}${report.backend === 'swc' ? ' (use --build-dir for production fidelity)' : ''}`);
  }
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
  if (t.total === 0 && report.filesScanned > 0 && report.skippedFiles.length === 0) {
    console.log('\n No components found in scanned files.');
  } else if (t.total === 0 && report.filesScanned === 0) {
    console.log('\n No source files found in target path.');
  }
  console.log('\u2500'.repeat(64) + '\n');
}

function gateExitCode(report: CoverageReport, allowSkipped: boolean): number | undefined {
  if (report.totals.total === 0) return 2;
  if (!allowSkipped && report.skippedFiles.length > 0) return 1;
  return undefined;
}

function main(): void {
  const { cmd, target, options, allowSkipped } = parseArgs(process.argv.slice(2));

  if (cmd === 'report') {
    printReport(runCoverage(target, options));
    return;
  }

  if (cmd === 'baseline') {
    const report = runCoverage(target, options);
    const gate = gateExitCode(report, allowSkipped);
    if (gate != null) process.exit(gate);
    writeBaseline(report, BASELINE_FILE);
    printReport(report);
    console.log(`Baseline written to ${BASELINE_FILE}\n`);
    return;
  }

  if (cmd === 'check') {
    const report = runCoverage(target, options);
    printReport(report);
    const gate = gateExitCode(report, allowSkipped);
    if (gate != null) {
      if (gate === 2) {
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
  console.error(
    'Usage: react-compiler-coverage <report|baseline|check> [path] [--config compiler-options.json] [--build-dir .next] [--allow-skipped]\n',
  );
  process.exit(2);
}

try {
  main();
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
}
