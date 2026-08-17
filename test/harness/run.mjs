#!/usr/bin/env node
/**
 * Ground-truth harness: minimal Next app with reactCompiler.
 * Compares webpack vs turbopack, minified vs unminified builds.
 *
 * Usage (from repo root):
 *   npm run test:harness              # webpack only
 *   npm run test:harness -- --turbopack   # include turbopack builds
 *   npm run test:harness -- --all           # webpack + turbopack
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runCoverage,
  scanBuildOutput,
  isMinifiedChunk,
  hasCompilerMarkers,
  hasSwcMemoCacheCall,
  enumerateComponents,
} from '../../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, 'next-app');
const componentsDir = path.join(appDir, 'components');

const args = process.argv.slice(2);
const includeTurbopack = args.includes('--turbopack') || args.includes('--all');
const webpackOnly = !includeTurbopack;

function run(cmd, env = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: appDir, stdio: 'inherit', env: { ...process.env, ...env } });
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.isFile() && f.endsWith('.js')) out.push(f);
  }
  return out;
}

function chunkDiagnostics(buildDir, names) {
  const all = walk(buildDir);
  const withPathComment = all.filter((f) => {
    const c = fs.readFileSync(f, 'utf8');
    return /;\/\/ \.\/components\//.test(c) || c.includes('./components/Header') || c.includes('./components/ProductCard');
  });
  const withFnName = all.filter((f) => {
    const c = fs.readFileSync(f, 'utf8');
    return names.some((n) => c.includes(`function ${n}`));
  });
  const clientPage = all.find((f) => f.includes('/static/chunks/app/page-') && f.endsWith('.js'));
  let sample = null;
  if (clientPage) {
    const content = fs.readFileSync(clientPage, 'utf8');
    sample = {
      file: path.basename(clientPage),
      hasCompilerMarkers: hasCompilerMarkers(content),
      minified: isMinifiedChunk(content, names),
      hasC: hasSwcMemoCacheCall(content),
      hasWebpackComment: /;\/\/ \.\/components\//.test(content),
    };
  }
  return {
    totalJs: all.length,
    chunksWithWebpackPathComment: withPathComment.length,
    chunksWithFunctionName: withFnName.length,
    clientPageChunk: sample,
  };
}

function scanBuild(label, buildDir) {
  console.log(`\n${'='.repeat(60)}\n${label}\n${'='.repeat(60)}`);

  const diag = chunkDiagnostics(buildDir, ['Header', 'ProductCard']);
  console.log(`\nChunk diagnostics:`);
  console.log(`  total .js files: ${diag.totalJs}`);
  console.log(`  with webpack path comments (;// ./components/…): ${diag.chunksWithWebpackPathComment}`);
  console.log(`  with function Header/ProductCard: ${diag.chunksWithFunctionName}`);
  if (diag.clientPageChunk) {
    const s = diag.clientPageChunk;
    console.log(`  client page chunk ${s.file}:`);
    console.log(`    markers=${s.hasCompilerMarkers} minified=${s.minified} .c(N)=${s.hasC} webpackComment=${s.hasWebpackComment}`);
  }

  for (const file of ['Header.tsx', 'ProductCard.tsx']) {
    const src = path.join(componentsDir, file);
    const code = fs.readFileSync(src, 'utf8');
    const comps = enumerateComponents(code, src);
    const scan = scanBuildOutput(src, buildDir, comps, appDir);

    console.log(`\n${file}:`);
    console.log(`  scan: reliable=${scan.reliable} matched=${scan.nameMatched}/${comps.length} chunks=${scan.chunksFound}`);
    scan.warnings.slice(0, 2).forEach((w) => console.log(`  warn: ${w.slice(0, 120)}`));
  }

  const report = runCoverage(componentsDir, { backend: 'swc', buildDir });
  console.log(`\nrunCoverage: available=${report.coverageAvailable} pct=${report.coveragePct} bundler=${report.buildBundler}`);
  console.log(`  label: ${report.coverageLabel}`);
  for (const c of report.components) {
    console.log(`  ${c.name}: ${c.status}`);
  }
  report.warnings
    .filter((w) => w.includes('excluded') || w.includes('unavailable') || w.includes('minified'))
    .forEach((w) => console.log(`  report: ${w.slice(0, 120)}`));
}

function cleanBuild() {
  const nextDir = path.join(appDir, '.next');
  if (fs.existsSync(nextDir)) fs.rmSync(nextDir, { recursive: true });
}

if (!fs.existsSync(path.join(appDir, 'node_modules'))) {
  run('npm install');
}

if (webpackOnly || args.includes('--all')) {
  console.log('\n########## WEBPACK (next build) ##########');
  cleanBuild();
  run('npm run build');
  scanBuild('WEBPACK · minified', path.join(appDir, '.next'));

  cleanBuild();
  run('npm run build:unminified');
  scanBuild('WEBPACK · unminified (minimize: false)', path.join(appDir, '.next'));
}

if (includeTurbopack) {
  console.log('\n########## TURBOPACK (next build --turbopack) ##########');
  cleanBuild();
  run('npm run build:turbopack');
  scanBuild('TURBOPACK · minified', path.join(appDir, '.next'));

  cleanBuild();
  run('npm run build:turbopack:unminified');
  scanBuild('TURBOPACK · unminified', path.join(appDir, '.next'));
}

console.log('\nInterpretation:');
console.log('- webpack: path comments (;// ./components/X) + function names');
console.log('- turbopack: export strings ("ProductCard") + (0,r.c)(N) — no webpack comments');
console.log('- minified builds: coverage unavailable for both bundlers');
console.log('- server components (Header): excluded from SWC denominator when no client memo slots\n');
