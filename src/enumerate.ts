import { parseSync, traverse } from '@babel/core';
import { presetsFor } from './babel.js';
import type { ComponentRecord } from './types.js';

export type ComponentLocation = Omit<ComponentRecord, 'status' | 'reason'>;

const isComponentName = (n?: string | null): n is string =>
  !!n && (/^[A-Z]/.test(n) || /^use[A-Z]/.test(n));

/**
 * Enumerate every component/hook in a file via a static AST pass.
 * This is the INDEPENDENT denominator: the compiler's logger stays silent for
 * components it optimizes nothing on, so events alone cannot tell us the total.
 */
export function enumerateComponents(code: string, file: string): ComponentLocation[] {
  const ast = parseSync(code, {
    filename: file,
    presets: [['@babel/preset-react', { runtime: 'automatic' }]],
  });
  const comps: ComponentLocation[] = [];
  if (!ast) return comps;

  traverse(ast, {
    FunctionDeclaration(path) {
      const name = path.node.id?.name;
      if (isComponentName(name) && path.node.loc) {
        comps.push({ name, file, startLine: path.node.loc.start.line, endLine: path.node.loc.end.line });
      }
    },
    VariableDeclarator(path) {
      const id = path.node.id;
      const init = path.node.init;
      if (
        id.type === 'Identifier' &&
        isComponentName(id.name) &&
        init &&
        (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') &&
        path.node.loc
      ) {
        comps.push({ name: id.name, file, startLine: path.node.loc.start.line, endLine: path.node.loc.end.line });
      }
    },
  });
  return comps;
}
