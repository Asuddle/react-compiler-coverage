import { transformSync } from '@babel/core';
import { presetsFor, resolveCompilerPlugin } from './babel.js';
import type { LoggerEvent } from './types.js';

/**
 * Compile a file with the React Compiler, capturing its per-function logger
 * events. Zero runtime overhead — this happens entirely at build time.
 */
export function collectEvents(code: string, file: string): LoggerEvent[] {
  const events: LoggerEvent[] = [];
  transformSync(code, {
    filename: file,
    presets: presetsFor(file),
    plugins: [
      [
        resolveCompilerPlugin(),
        { logger: { logEvent: (_f: string, e: LoggerEvent) => void events.push(e) } },
      ],
    ],
  });
  return events;
}
