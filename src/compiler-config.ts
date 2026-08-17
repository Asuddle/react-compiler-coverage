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

export interface ResolvedCompilerOptions {
  options: Record<string, unknown>;
  warnings: string[];
}

/**
 * Resolve React Compiler plugin options to mirror the user's real build.
 */
export function resolveCompilerOptionsWithWarnings(
  configPath?: string,
  inline?: Record<string, unknown>,
  cwd = process.cwd(),
): ResolvedCompilerOptions {
  const warnings: string[] = [];

  if (inline && Object.keys(inline).length > 0) return { options: { ...inline }, warnings };
  if (explicitOptions) return { options: { ...explicitOptions }, warnings };

  const envPath = process.env.REACT_COMPILER_COVERAGE_CONFIG;
  if (configPath) return { options: fromJsonFile(configPath), warnings };
  if (envPath) return { options: fromJsonFile(envPath), warnings };

  const babelOpts = fromBabelConfig(cwd);
  if (babelOpts) return { options: babelOpts, warnings };

  const next = loadNextConfig(cwd);
  warnings.push(...next.warnings);
  return { options: next.options ?? {}, warnings };
}

/** Resolve compiler options (warnings discarded — use resolveCompilerOptionsWithWarnings in coverage). */
export function resolveCompilerOptions(
  configPath?: string,
  inline?: Record<string, unknown>,
): Record<string, unknown> {
  return resolveCompilerOptionsWithWarnings(configPath, inline).options;
}
