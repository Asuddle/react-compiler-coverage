import fs from 'node:fs';
import path from 'node:path';
import type { ComponentLocation } from './enumerate.js';
import type { LoggerEvent } from './types.js';

const JS_EXT = /\.(js|mjs|cjs)$/;
const IGNORE = new Set(['node_modules', '.git', 'cache']);

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

function sourcePathVariants(sourceFile: string, cwd: string): string[] {
  const abs = path.resolve(sourceFile);
  const rel = path.relative(cwd, abs);
  const variants = new Set([abs, rel, abs.replace(/\\/g, '/'), rel.replace(/\\/g, '/')]);
  return [...variants].filter(Boolean);
}

function findChunksForSource(buildDir: string, sourceFile: string, cwd: string): string[] {
  const needles = sourcePathVariants(sourceFile, cwd);
  const chunks: string[] = [];
  for (const chunkFile of walkJs(buildDir)) {
    const content = fs.readFileSync(chunkFile, 'utf8');
    if (needles.some((n) => content.includes(n))) chunks.push(content);
  }
  return chunks;
}

function componentOptimizedInChunk(chunk: string, comp: ComponentLocation): boolean {
  const markers = [
    `function ${comp.name}`,
    `function ${comp.name}(`,
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
  if (idx === -1) {
    // Fall back: chunk references the file and contains compiler markers anywhere
    return /\b_c\s*\(/.test(chunk) && chunk.includes(String(comp.startLine));
  }
  const slice = chunk.slice(idx, idx + 4000);
  return /\b_c\s*\(/.test(slice) || /react\/compiler-runtime/.test(slice);
}

/**
 * Infer compiler logger events from SWC/Turbopack/Webpack build output.
 * Used when the real build does not run through babel-plugin-react-compiler.
 */
export function collectEventsFromBuild(
  sourceFile: string,
  buildDir: string,
  components: ComponentLocation[],
  cwd = process.cwd(),
): LoggerEvent[] {
  const chunks = findChunksForSource(buildDir, sourceFile, cwd);
  if (chunks.length === 0) return [];

  const events: LoggerEvent[] = [];
  for (const comp of components) {
    if (chunks.some((chunk) => componentOptimizedInChunk(chunk, comp))) {
      events.push({
        kind: 'CompileSuccess',
        fnLoc: { start: { line: comp.startLine } },
        memoBlocks: 1,
      });
    }
  }
  return events;
}
