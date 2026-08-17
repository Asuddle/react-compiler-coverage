import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface NextConfigLoadResult {
  options?: Record<string, unknown>;
  warnings: string[];
}

export function extractReactCompilerOptions(
  config: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const rc =
    config.reactCompiler ??
    (config.experimental as Record<string, unknown> | undefined)?.reactCompiler;
  if (rc === true) return {};
  if (rc && typeof rc === 'object') return { ...(rc as Record<string, unknown>) };
  return undefined;
}

/** Best-effort parse when TS loaders aren't available. Returns guessed options. */
export function parseReactCompilerFromSource(source: string): Record<string, unknown> | undefined {
  const patterns = [
    /reactCompiler\s*:\s*true\b/,
    /experimental\s*:\s*\{[^}]*reactCompiler\s*:\s*true/,
  ];
  if (patterns.some((p) => p.test(source))) return {};

  const objMatch =
    source.match(/reactCompiler\s*:\s*(\{[\s\S]*?\})\s*,?\s*(?:\n|\r|$|\/\/|\/\*|\})/) ??
    source.match(/experimental\s*:\s*\{[\s\S]*?reactCompiler\s*:\s*(\{[\s\S]*?\})/);
  if (!objMatch?.[1]) return undefined;

  const objBody = objMatch[1];
  try {
    const parsed = JSON.parse(
      objBody
        .replace(/(\w+)\s*:/g, '"$1":')
        .replace(/'/g, '"'),
    ) as Record<string, unknown>;
    return parsed;
  } catch {
    const mode = objBody.match(/compilationMode\s*:\s*['"](\w+)['"]/);
    if (mode?.[1]) return { compilationMode: mode[1] };
    return {};
  }
}

function guessedConfigWarning(file: string): string {
  return (
    `Guessed reactCompiler options from ${path.basename(file)} source — regex parsing ` +
    `can be wrong on conditionals, spreads, or computed values. Install tsx or esbuild ` +
    `in this project for reliable next.config.ts loading.`
  );
}

function loadJsModule(file: string, cwd: string): Record<string, unknown> | undefined {
  const requireFromCwd = createRequire(path.join(cwd, '__next__.js'));
  const mod = requireFromCwd(file) as { default?: Record<string, unknown> } | Record<string, unknown>;
  return (mod as { default?: Record<string, unknown> }).default ?? (mod as Record<string, unknown>);
}

function loadTypeScriptModule(file: string, cwd: string): Record<string, unknown> | undefined {
  const requireFromCwd = createRequire(path.join(cwd, '__next__.js'));

  for (const entry of ['tsx/cjs/api', 'tsx/esm/api']) {
    try {
      const api = requireFromCwd(entry) as { register?: () => void };
      api.register?.();
      return loadJsModule(file, cwd);
    } catch {
      /* try next loader */
    }
  }

  try {
    const esbuildPath = requireFromCwd.resolve('esbuild');
    const esbuild = requireFromCwd(esbuildPath) as {
      buildSync: (opts: Record<string, unknown>) => { errors: unknown[] };
    };
    const outFile = path.join(os.tmpdir(), `rcc-next-${process.pid}-${Date.now()}.cjs`);
    try {
      esbuild.buildSync({
        entryPoints: [file],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: outFile,
        logLevel: 'silent',
        external: ['next', 'webpack', '@next/bundle-analyzer'],
      });
      return loadJsModule(outFile, cwd);
    } finally {
      if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    }
  } catch {
    return undefined;
  }
}

/** Load next.config.{js,mjs,cjs,ts} and extract reactCompiler options. */
export function loadNextConfig(cwd: string): NextConfigLoadResult {
  const warnings: string[] = [];
  const candidates = ['next.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.cjs'];

  for (const name of candidates) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;

    try {
      let config: Record<string, unknown> | undefined;
      if (name.endsWith('.ts')) {
        config = loadTypeScriptModule(file, cwd);
        if (!config) {
          const fromSource = parseReactCompilerFromSource(fs.readFileSync(file, 'utf8'));
          if (fromSource) {
            warnings.push(guessedConfigWarning(file));
            return { options: fromSource, warnings };
          }
          continue;
        }
      } else {
        config = loadJsModule(file, cwd);
      }
      const rc = extractReactCompilerOptions(config ?? {});
      if (rc) return { options: rc, warnings };
    } catch {
      if (name.endsWith('.ts')) {
        const fromSource = parseReactCompilerFromSource(fs.readFileSync(file, 'utf8'));
        if (fromSource) {
          warnings.push(guessedConfigWarning(file));
          return { options: fromSource, warnings };
        }
      }
    }
  }
  return { warnings };
}

/** @deprecated Use loadNextConfig(cwd).options */
export function loadNextConfigOptions(cwd: string): Record<string, unknown> | undefined {
  return loadNextConfig(cwd).options;
}
