import type { TransformOptions } from '@babel/core';

/**
 * Babel presets for a source file. `.ts`/`.tsx` need the TypeScript preset or
 * the parser throws on type syntax; without this, TS files would fail to parse
 * and silently drop out of coverage.
 */
export function presetsFor(file: string): NonNullable<TransformOptions['presets']> {
  const presets: NonNullable<TransformOptions['presets']> = [
    ['@babel/preset-react', { runtime: 'automatic' }],
  ];
  if (/\.tsx?$/.test(file)) {
    presets.push(['@babel/preset-typescript', { isTSX: file.endsWith('.tsx'), allExtensions: true }]);
  }
  return presets;
}
