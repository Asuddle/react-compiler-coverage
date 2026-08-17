import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

/** Best-effort parse when TS loaders aren't available. */
export function parseReactCompilerFromSource(source: string): Record<string, unknown> | undefined {
  const trueMatch = source.match(/reactCompiler\s*:\s*true\b/);
  if (trueMatch) return {};

  const objMatch = source.match(/reactCompiler\s*:\s*(\{[\s\S]*?\})\s*,?\s*(?:\n|\r|$|\/\/|\/\*|\})/);
  if (!objMatch?.[1]) return undefined;

  try {
    // Wrap so bare keys are valid JS object literal for Function eval alternative
    const parsed = JSON.parse(
      objMatch[1]
        .replace(/(\w+)\s*:/g, '"$1":')
        .replace(/'/g, '"'),
    ) as Record<string, unknown>;
    return parsed;
  } catch {
    const mode = objMatch[1].match(/compilationMode\s*:\s*['"](\w+)['"]/);
    if (mode?.[1]) return { compilationMode: mode[1] };
    return {};
  }
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
export function loadNextConfig(cwd: string): Record<string, unknown> | undefined {
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
          if (fromSource) return fromSource;
          continue;
        }
      } else {
        config = loadJsModule(file, cwd);
      }
      const rc = extractReactCompilerOptions(config ?? {});
      if (rc) return rc;
    } catch {
      if (name.endsWith('.ts')) {
        const fromSource = parseReactCompilerFromSource(fs.readFileSync(file, 'utf8'));
        if (fromSource) return fromSource;
      }
    }
  }
  return undefined;
}
