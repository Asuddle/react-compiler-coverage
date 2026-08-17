import fs from 'node:fs';
import path from 'node:path';
import { parseSync, traverse, types as t } from '@babel/core';
import type { NodePath } from '@babel/core';
import { ISOLATED_BABEL, presetsFor } from './babel.js';
import { resolveSourceModule } from './resolve-module.js';
import type { ComponentRecord } from './types.js';

export type ComponentLocation = Omit<ComponentRecord, 'status' | 'reason'>;

const isComponentName = (n?: string | null): n is string =>
  !!n && (/^[A-Z]/.test(n) || /^use[A-Z]/.test(n));

const HOC_NAMES = new Set(['memo', 'forwardRef', 'lazy']);

function isHoCCall(node: t.CallExpression): boolean {
  const { callee } = node;
  if (callee.type === 'Identifier') return HOC_NAMES.has(callee.name);
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return HOC_NAMES.has(callee.property.name);
  }
  return false;
}

function unwrapFunctionNode(
  node: t.Node | null | undefined,
  scopePath?: NodePath,
): t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration | null {
  if (!node) return null;
  if (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration'
  ) {
    return node;
  }
  if (node.type === 'Identifier' && scopePath) {
    const binding = scopePath.scope.getBinding(node.name);
    if (!binding) return null;
    if (binding.path.isFunctionDeclaration()) return binding.path.node;
    if (binding.path.isVariableDeclarator()) {
      return componentFunctionFromInit(binding.path.node.init, binding.path);
    }
  }
  return null;
}

function componentFunctionFromInit(
  init: t.Expression | null | undefined,
  scopePath?: NodePath,
): t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration | null {
  if (!init) return null;
  const direct = unwrapFunctionNode(init, scopePath);
  if (direct) return direct;
  if (init.type === 'CallExpression' && isHoCCall(init)) {
    return unwrapFunctionNode(init.arguments[0], scopePath);
  }
  return null;
}

function isReactClassSuper(superClass: t.Expression | null | undefined): boolean {
  if (!superClass) return false;
  if (superClass.type === 'Identifier') {
    return superClass.name === 'Component' || superClass.name === 'PureComponent';
  }
  if (superClass.type === 'MemberExpression' && superClass.property.type === 'Identifier') {
    const prop = superClass.property.name;
    return prop === 'Component' || prop === 'PureComponent';
  }
  return false;
}

function pushComponent(
  comps: ComponentLocation[],
  name: string,
  file: string,
  loc: { start: { line: number }; end: { line: number } },
): void {
  comps.push({ name, file, startLine: loc.start.line, endLine: loc.end.line });
}

function defaultExportName(file: string): string {
  const base = file.replace(/\.[^.]+$/, '').split(/[/\\]/).pop() ?? 'Default';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function enumerateLocalComponents(code: string, file: string): ComponentLocation[] {
  const ast = parseSync(code, {
    filename: file,
    presets: presetsFor(file),
    ...ISOLATED_BABEL,
  });
  const comps: ComponentLocation[] = [];
  if (!ast) return comps;

  traverse(ast, {
    FunctionDeclaration(path) {
      const name = path.node.id?.name;
      if (isComponentName(name) && path.node.loc) {
        pushComponent(comps, name, file, path.node.loc);
      }
    },
    VariableDeclarator(path) {
      const id = path.node.id;
      if (id.type !== 'Identifier' || !isComponentName(id.name)) return;
      const inner = componentFunctionFromInit(path.node.init, path);
      if (inner?.loc) pushComponent(comps, id.name, file, inner.loc);
    },
    ClassDeclaration(path) {
      const name = path.node.id?.name;
      if (isComponentName(name) && isReactClassSuper(path.node.superClass) && path.node.loc) {
        pushComponent(comps, name, file, path.node.loc);
      }
    },
    ExportDefaultDeclaration(path) {
      const decl = path.node.declaration;
      if (decl.type === 'FunctionDeclaration' && isComponentName(decl.id?.name) && decl.loc) {
        pushComponent(comps, decl.id.name, file, decl.loc);
        return;
      }
      const inner =
        decl.type === 'CallExpression'
          ? componentFunctionFromInit(decl, path)
          : unwrapFunctionNode(decl, path);
      if (!inner?.loc) return;
      const name = inner.type === 'FunctionExpression' && inner.id?.name ? inner.id.name : defaultExportName(file);
      pushComponent(comps, name, file, inner.loc);
    },
  });
  return comps;
}

function enumerateReExports(
  code: string,
  file: string,
  visited: Set<string>,
): ComponentLocation[] {
  const ast = parseSync(code, {
    filename: file,
    presets: presetsFor(file),
    ...ISOLATED_BABEL,
  });
  if (!ast) return [];

  const comps: ComponentLocation[] = [];
  traverse(ast, {
    ExportNamedDeclaration(path) {
      const src = path.node.source?.value;
      if (typeof src !== 'string') return;
      const resolved = resolveSourceModule(file, src);
      if (!resolved) return;

      if (path.node.specifiers.length === 0) {
        comps.push(...enumerateModule(resolved, visited));
        return;
      }

      const exported = enumerateModule(resolved, visited);
      for (const spec of path.node.specifiers) {
        if (spec.type !== 'ExportSpecifier') continue;
        const localName = spec.local.name;
        const exportName =
          spec.exported.type === 'Identifier' ? spec.exported.name : localName;
        let match = exported.find((c) => c.name === localName);
        if (!match && localName === 'default') {
          match = exported.find((c) => c.name === exportName) ?? exported[0];
        }
        if (match) comps.push({ ...match, name: exportName });
      }
    },
  });
  return comps;
}

function dedupeComponents(comps: ComponentLocation[]): ComponentLocation[] {
  const seen = new Set<string>();
  const out: ComponentLocation[] = [];
  for (const c of comps) {
    const key = `${c.file}:${c.name}:${c.startLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Enumerate every component/hook in a file via a static AST pass.
 * Follows re-exports in barrel files to components defined elsewhere.
 */
export function enumerateComponents(code: string, file: string, visited = new Set<string>()): ComponentLocation[] {
  const abs = path.resolve(file);
  if (visited.has(abs)) return [];
  visited.add(abs);

  const local = enumerateLocalComponents(code, abs);
  const reExported = enumerateReExports(code, abs, visited);
  return dedupeComponents([...local, ...reExported]);
}

/** Read and enumerate a module, following re-exports. */
export function enumerateModule(file: string, visited = new Set<string>()): ComponentLocation[] {
  const code = fs.readFileSync(file, 'utf8');
  return enumerateComponents(code, file, visited);
}
