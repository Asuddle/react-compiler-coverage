import fs from 'node:fs';
import path from 'node:path';
import type { ComponentLocation } from './enumerate.js';
import type { LoggerEvent } from './types.js';

const JS_EXT = /\.(js|mjs|cjs)$/;
const IGNORE = new Set(['node_modules', '.git', 'cache']);

export type BuildBundler = 'webpack' | 'turbopack' | 'unknown';

export interface BuildScanResult {
  events: LoggerEvent[];
  reliable: boolean;
  warnings: string[];
  chunksFound: number;
  minifiedChunks: number;
  nameMatched: number;
  buildBundler: BuildBundler;
}

function walkJs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE.has(entry.name) && !entry.name.startsWith('.')) walkJs(full, out);
    } else if (JS_EXT.test(entry.name) && !entry.name.endsWith('.map')) {
      out.push(full);
    }
  }
  return out;
}

function readChunks(buildDir: string): { file: string; content: string }[] {
  return walkJs(buildDir).map((file) => ({ file, content: fs.readFileSync(file, 'utf8') }));
}

/** Detect webpack vs turbopack from build output shape. */
export function detectBuildBundler(buildDir: string): BuildBundler {
  for (const file of walkJs(buildDir)) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('TURBOPACK') || content.includes('[project]/')) return 'turbopack';
    if (content.includes('webpackChunk') || /;\/\/ \.\//.test(content)) return 'webpack';
  }
  return 'unknown';
}

function sourcePathVariants(sourceFile: string, cwd: string): string[] {
  const abs = path.resolve(sourceFile);
  const rel = path.relative(cwd, abs).replace(/\\/g, '/');
  const base = path.basename(abs);
  const stem = base.replace(/\.[^.]+$/, '');
  const underscored = rel.replace(/[/\\.]/g, '_').replace(/\.tsx?$/, '_tsx');
  return [
    ...new Set([
      abs,
      abs.replace(/\\/g, '/'),
      rel,
      `./${rel}`,
      base,
      `;// ./${rel}`,
      `components/${base}`,
      `./components/${base}`,
      `[project]/${rel}`,
      `[project]//${rel}`,
      underscored,
      `_components_${stem}_tsx_`,
    ]),
  ].filter(Boolean);
}

function chunkReferencesComponent(
  content: string,
  comp: ComponentLocation,
  sourceFile: string,
  cwd: string,
): boolean {
  if (sourcePathVariants(sourceFile, cwd).some((n) => content.includes(n))) return true;
  if (content.includes(`function ${comp.name}`) || content.includes(`function ${comp.name}(`)) {
    return true;
  }
  // Turbopack: export name preserved even when function is mangled (function i)
  if (content.includes(`"${comp.name}"`) && hasSwcMemoCacheCall(content)) return true;
  if (content.includes(`["${comp.name}"`) && hasSwcMemoCacheCall(content)) return true;
  return false;
}

function findChunksForComponents(
  chunks: { file: string; content: string }[],
  sourceFile: string,
  components: ComponentLocation[],
  cwd: string,
): string[] {
  const out: string[] = [];
  for (const { content } of chunks) {
    if (sourcePathVariants(sourceFile, cwd).some((n) => content.includes(n))) {
      out.push(content);
      continue;
    }
    if (components.some((c) => chunkReferencesComponent(content, c, sourceFile, cwd))) {
      out.push(content);
    }
  }
  return out;
}

/** Minified = long lines AND no readable component names or turbopack export strings. */
export function isMinifiedChunk(content: string, componentNames: string[]): boolean {
  const lines = content.split('\n');
  const avgLineLen = content.length / Math.max(lines.length, 1);
  if (avgLineLen > 300) {
    const hasExportAnchor = componentNames.some(
      (name) => content.includes(`"${name}"`) && hasSwcMemoCacheCall(content),
    );
    if (!hasExportAnchor) return true;
  }

  const hasReadableName = componentNames.some(
    (name) =>
      content.includes(`function ${name}`) ||
      content.includes(`function ${name}(`) ||
      content.includes(`var ${name}`) ||
      content.includes(`let ${name}`) ||
      content.includes(`const ${name}`) ||
      (content.includes(`"${name}"`) && hasSwcMemoCacheCall(content)),
  );
  const hasCompilerMarker = hasCompilerMarkers(content);

  return hasCompilerMarker && !hasReadableName && componentNames.length > 0;
}

/** SWC client memo cache: `.c(N)` or turbopack `(0,r.c)(N)` after runtime import. */
export function hasSwcMemoCacheCall(code: string): boolean {
  return /\.c\)?\(\s*\d+\s*\)/.test(code);
}

export function hasCompilerMarkers(code: string): boolean {
  return (
    /\b_c\s*\(/.test(code) ||
    /react\/compiler-runtime/.test(code) ||
    /react_compiler_runtime/.test(code) ||
    /react-compiler-runtime/.test(code) ||
    /useMemoCache\s*\(/.test(code) ||
    (hasSwcMemoCacheCall(code) && /\[\d+\]/.test(code))
  );
}

function sliceAroundComponent(chunk: string, comp: ComponentLocation): string {
  const markers = [
    `function ${comp.name}`,
    `function ${comp.name}(`,
    `"${comp.name}"`,
    `["${comp.name}"`,
    `var ${comp.name}`,
    `let ${comp.name}`,
    `const ${comp.name}`,
    `${comp.name}=`,
  ];
  let idx = -1;
  for (const m of markers) {
    const i = chunk.indexOf(m);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return chunk.slice(0, 8000);
  return chunk.slice(idx, idx + 8000);
}

function componentOptimizedInChunk(chunk: string, comp: ComponentLocation): boolean {
  return hasCompilerMarkers(sliceAroundComponent(chunk, comp));
}

const UNMINIFIED_HINT =
  'Build output looks minified — component names were stripped. Rebuild unminified ' +
  '(webpack: optimization.minimize false; turbopack: no minifier yet but names may still be mangled) ' +
  'and pass --build-dir. Minification is orthogonal to compiler decisions.';

const NO_CHUNKS_HINT =
  'No build chunks reference this source file or its component names. Ensure --build-dir ' +
  'points at a fresh build that includes these components.';

const NO_LOGGER_HINT =
  'SWC does not expose babel-plugin-react-compiler logger events. Coverage is inferred from ' +
  'build output markers (.c(N), _c(, useMemoCache). Server Components may lack client memo ' +
  'slots; Turbopack uses export-name anchors when function names are mangled.';

const TURBOPACK_ATTRIBUTION_HINT =
  'Turbopack build detected. Attribution uses export names + .c(N) markers, not webpack ' +
  'path comments. Server Components may still be excluded from the denominator.';

export function scanBuildOutput(
  sourceFile: string,
  buildDir: string,
  components: ComponentLocation[],
  cwd = process.cwd(),
): BuildScanResult {
  const buildBundler = detectBuildBundler(buildDir);
  const warnings: string[] = [NO_LOGGER_HINT];
  if (buildBundler === 'turbopack') warnings.push(TURBOPACK_ATTRIBUTION_HINT);

  const allChunks = readChunks(buildDir);
  const names = components.map((c) => c.name);
  const chunks = findChunksForComponents(allChunks, sourceFile, components, cwd);

  if (chunks.length === 0) {
    return {
      events: [],
      reliable: false,
      warnings: [...warnings, NO_CHUNKS_HINT],
      chunksFound: 0,
      minifiedChunks: 0,
      nameMatched: 0,
      buildBundler,
    };
  }

  const minifiedChunks = chunks.filter((c) => isMinifiedChunk(c, names)).length;
  if (minifiedChunks === chunks.length) warnings.push(UNMINIFIED_HINT);
  else if (minifiedChunks > 0) {
    warnings.push(`${minifiedChunks}/${chunks.length} referencing chunks look minified.`);
  }

  const readableChunks = chunks.filter((c) => !isMinifiedChunk(c, names));
  const scanChunks = readableChunks.length > 0 ? readableChunks : chunks;

  const events: LoggerEvent[] = [];
  let nameMatched = 0;
  for (const comp of components) {
    if (scanChunks.some((chunk) => componentOptimizedInChunk(chunk, comp))) {
      nameMatched++;
      events.push({
        kind: 'CompileSuccess',
        fnLoc: { start: { line: comp.startLine } },
        memoBlocks: 1,
      });
    }
  }

  const reliable = readableChunks.length > 0 && nameMatched > 0;
  if (!reliable && minifiedChunks > 0 && events.length === 0) warnings.push(UNMINIFIED_HINT);

  return {
    events,
    reliable,
    warnings: [...new Set(warnings)],
    chunksFound: chunks.length,
    minifiedChunks,
    nameMatched,
    buildBundler,
  };
}

export function collectEventsFromBuild(
  sourceFile: string,
  buildDir: string,
  components: ComponentLocation[],
  cwd = process.cwd(),
): LoggerEvent[] {
  return scanBuildOutput(sourceFile, buildDir, components, cwd).events;
}

export function hasBuildEvidence(result: BuildScanResult): boolean {
  return result.reliable && result.events.length > 0;
}
