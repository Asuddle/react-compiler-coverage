import { createRequire } from 'node:module';
import path from 'node:path';
import type { TransformOptions } from '@babel/core';

// Babel resolves preset/plugin *strings* relative to the user's project (cwd),
// not to this package. So we resolve dependencies to absolute paths from the
// right place: our own presets from THIS package's node_modules, and the
// compiler plugin (a peer dependency) from the user's project.
const requireHere = createRequire(import.meta.url);
const REACT_PRESET = requireHere.resolve('@babel/preset-react');
const TS_PRESET = requireHere.resolve('@babel/preset-typescript');

/** Isolated parse/transform — never merge with the project's babel.config. */
export const ISOLATED_BABEL: Pick<TransformOptions, 'configFile' | 'babelrc'> = {
  configFile: false,
  babelrc: false,
};

/**
 * Babel presets for a source file. `.ts`/`.tsx` need the TypeScript preset or
 * the parser throws on type syntax; without it TS files fail to parse and drop
 * out of coverage.
 */
export function presetsFor(file: string): NonNullable<TransformOptions['presets']> {
  const presets: NonNullable<TransformOptions['presets']> = [
    [REACT_PRESET, { runtime: 'automatic' }],
  ];
  if (/\.tsx?$/.test(file)) {
    presets.push([TS_PRESET, { isTSX: file.endsWith('.tsx'), allExtensions: true }]);
  }
  return presets;
}

let compilerPluginPath: string | undefined;

/**
 * Absolute path to `babel-plugin-react-compiler`, resolved from the user's
 * project (it's a peer dependency and lives there, not in this package).
 * Throws a clear, actionable error if it isn't installed.
 */
export function resolveCompilerPlugin(): string {
  if (compilerPluginPath) return compilerPluginPath;
  // Resolve relative to the user's cwd, regardless of where this package lives.
  const requireFromCwd = createRequire(path.join(process.cwd(), '__resolve__.js'));
  try {
    compilerPluginPath = requireFromCwd.resolve('babel-plugin-react-compiler');
  } catch {
    throw new Error(
      'babel-plugin-react-compiler is not installed in this project.\n' +
        'Install it as a dev dependency:  npm install -D babel-plugin-react-compiler',
    );
  }
  return compilerPluginPath;
}
