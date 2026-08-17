import babel from '@babel/core';
import fs from 'node:fs';
import path from 'node:path';
import { loadNextConfig } from './next-config.js';

const COMPILER_PLUGIN_RE = /react-compiler/;

function pluginIdentity(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    const head = entry[0];
    if (typeof head === 'string') return head;
    if (typeof head === 'function') return head.name || 'anonymous';
  }
  if (typeof entry === 'function') return entry.name || 'anonymous';
  return '';
}

function hasBabelCompilerPlugin(cwd: string): boolean {
  const load = (
    babel as unknown as {
      loadPartialConfigSync?: (opts: { filename: string; cwd: string }) => {
        options?: { plugins?: unknown[] };
      } | null;
    }
  ).loadPartialConfigSync;
  if (!load) return false;
  const partial = load({ filename: path.join(cwd, 'index.jsx'), cwd });
  return (partial?.options?.plugins ?? []).some((p) => COMPILER_PLUGIN_RE.test(pluginIdentity(p)));
}

export type CompilerBackend = 'babel' | 'swc' | 'unknown';

/**
 * Detect how the React Compiler runs in this project.
 * Next.js + reactCompiler uses SWC; explicit babel-plugin uses Babel.
 */
export function detectCompilerBackend(cwd = process.cwd()): CompilerBackend {
  if (hasBabelCompilerPlugin(cwd)) return 'babel';
  if (loadNextConfig(cwd) != null) return 'swc';
  return 'unknown';
}

export function defaultBuildDir(cwd = process.cwd()): string | undefined {
  for (const name of ['.next', 'dist', 'build']) {
    const dir = path.join(cwd, name);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  return undefined;
}
