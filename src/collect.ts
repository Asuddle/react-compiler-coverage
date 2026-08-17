import { transformSync } from '@babel/core';
import { ISOLATED_BABEL, presetsFor, resolveCompilerPlugin } from './babel.js';
import { resolveCompilerOptions } from './compiler-config.js';
import type { CoverageOptions, LoggerEvent } from './types.js';

/**
 * Compile a file with the React Compiler, capturing its per-function logger
 * events. Uses the project's compiler options (babel.config / next.config) so
 * results match the real build.
 */
export function collectEvents(
  code: string,
  file: string,
  options?: Pick<CoverageOptions, 'config' | 'compilerOptions'>,
): LoggerEvent[] {
  const events: LoggerEvent[] = [];
  const compilerOpts = resolveCompilerOptions(options?.config, options?.compilerOptions);
  transformSync(code, {
    filename: file,
    presets: presetsFor(file),
    plugins: [
      [
        resolveCompilerPlugin(),
        {
          ...compilerOpts,
          logger: { logEvent: (_f: string, e: LoggerEvent) => void events.push(e) },
        },
      ],
    ],
    ...ISOLATED_BABEL,
  });
  return events;
}
