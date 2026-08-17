import babel from '@babel/core';
import fs from 'node:fs';
import path from 'node:path';
import { loadNextConfig } from './next-config.js';

const COMPILER_PLUGIN_RE = /react-compiler/;

let explicitOptions: Record<string, unknown> | undefined;

/** Override compiler options (tests / programmatic API). */
export function setCompilerOptions(opts: Record<string, unknown> | undefined): void {
  explicitOptions = opts;
}

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

function pluginOptions(entry: unknown): Record<string, unknown> {
  if (Array.isArray(entry) && entry[1] && typeof entry[1] === 'object' && !Array.isArray(entry[1])) {
    return { ...(entry[1] as Record<string, unknown>) };
  }
  return {};
}

interface PartialBabelConfig {
  options: { plugins?: unknown[] };
}

function loadProjectBabelConfig(cwd: string): PartialBabelConfig | null {
  const load = (
    babel as unknown as {
      loadPartialConfigSync?: (opts: { filename: string; cwd: string }) => PartialBabelConfig | null;
    }
  ).loadPartialConfigSync;
  if (!load) return null;
  return load({ filename: path.join(cwd, 'index.jsx'), cwd });
}

function fromBabelConfig(cwd: string): Record<string, unknown> | undefined {
  const partial = loadProjectBabelConfig(cwd);
  for (const plugin of partial?.options.plugins ?? []) {
    const id = pluginIdentity(plugin);
    if (!COMPILER_PLUGIN_RE.test(id)) continue;
    const opts = pluginOptions(plugin);
    delete opts.logger;
    return opts;
  }
  return undefined;
}

function fromJsonFile(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/**
 * Resolve React Compiler plugin options to mirror the user's real build.
 * Priority: inline options → programmatic override → REACT_COMPILER_COVERAGE_CONFIG
 * env → --config file → babel.config* → next.config* → {} (default mode).
 */
export function resolveCompilerOptions(
  configPath?: string,
  inline?: Record<string, unknown>,
): Record<string, unknown> {
  if (inline && Object.keys(inline).length > 0) return { ...inline };
  if (explicitOptions) return { ...explicitOptions };

  const envPath = process.env.REACT_COMPILER_COVERAGE_CONFIG;
  if (configPath) return fromJsonFile(configPath);
  if (envPath) return fromJsonFile(envPath);

  const cwd = process.cwd();
  return fromBabelConfig(cwd) ?? loadNextConfig(cwd) ?? {};
}
