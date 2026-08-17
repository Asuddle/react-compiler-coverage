# react-compiler-coverage

Coverage reporting and a CI regression gate for the [React Compiler](https://react.dev/learn/react-compiler).

The React Compiler optimizes components silently. If it can't optimize one, it
skips it **without warning** — so you think your app is memoized when parts of it
aren't. This tool tells you exactly which components are:

- **optimized** — the compiler injected memoization (`CompileSuccess`)
- **error** — a Rules-of-React violation stopped optimization (`CompileError`)
- **opt-out** — a `'use no memo'` directive (`CompileSkip`)
- **silent** — enumerated but the compiler emitted nothing for it

That last bucket is the point: it can't be derived from the compiler's events
alone, because silent components produce no event. `react-compiler-coverage`
enumerates components with an independent AST pass and reconciles them against
compiler signals, so the denominator is real.

## Install

```sh
npm install -D react-compiler-coverage
# peer dependency (you already have this if you use the compiler):
npm install -D babel-plugin-react-compiler
```

## Usage

```sh
# Print a coverage report for a directory
npx react-compiler-coverage report src

# Record a baseline (commit the generated .react-compiler-coverage.json)
npx react-compiler-coverage baseline src

# Fail if any component regressed vs the baseline (use in CI)
npx react-compiler-coverage check src
```

### CLI flags

| Flag | Description |
|---|---|
| `--config <path>` | JSON file with React Compiler plugin options (overrides auto-detection) |
| `--build-dir <path>` | Unminified build output (`.next`, `dist`) for SWC/Turbopack scanning |
| `--allow-skipped` | Don't fail `check` when files couldn't be parsed |
| `--allow-unavailable` | Don't exit when SWC coverage is unavailable (minified / no build) |

Set `REACT_COMPILER_COVERAGE_CONFIG=/path/to/options.json` to override config via env.

### Matching your real build

The tool runs an **isolated** Babel + React Compiler pass (`configFile: false`) so
it never double-runs or clashes with your project's Babel pipeline. Compiler
**options** are read from your project so the pass matches production:

| Source | What it reads |
|---|---|
| `babel.config.*` | `babel-plugin-react-compiler` plugin options |
| `next.config.js` / `.mjs` / `.cjs` / `.ts` | `reactCompiler` (or `experimental.reactCompiler`) |
| `--config` / `REACT_COMPILER_COVERAGE_CONFIG` | Explicit JSON override |

`next.config.ts` is loaded via tsx/esbuild when available in your project. If neither
is installed, the tool **guesses** `reactCompiler` from the source with regex and
emits an explicit warning — that guess can be wrong on conditionals, spreads, or
computed values.

Example explicit config (`react-compiler.json`):

```json
{
  "compilationMode": "annotation"
}
```

```sh
npx react-compiler-coverage report src --config react-compiler.json
```

### Next.js / SWC / Turbopack

Next.js 15 runs the React Compiler through SWC — **not** through Babel's logger.
There is no `CompileSuccess`/`CompileError` event stream from a real Next build
today. Coverage is inferred by scanning **unminified** build output.

**What the headline number measures:** on App Router apps, the reported percentage
is **client-component coverage (SWC)**, not "your whole app is optimized." Server
Components are excluded from the SWC denominator (they often have no client memo
slots in RSC bundles). A modern app can be mostly Server Components — `100% (1/1
client components)` is honest but easy to misread without the label.

**Minification is orthogonal** to compiler decisions (memoization happens before
the minifier). Scan an unminified build — same compiler work, readable names.
This is real adoption friction in CI (you're not scanning your prod artifact), but
it's the honest option: minification erases the labels the scanner needs, not the
optimization itself.

```js
// next.config.mjs
export default {
  experimental: { reactCompiler: true },
  webpack: (config, { dev }) => {
    if (process.env.RCC_UNMINIFIED === '1' && !dev) {
      config.optimization = { ...config.optimization, minimize: false };
    }
    return config;
  },
};
```

```sh
RCC_UNMINIFIED=1 next build
npx react-compiler-coverage report src/components --build-dir .next
```

The tool auto-detects the compiler backend (`babel` vs `swc`) and build bundler
(`webpack` vs `turbopack`):

| Backend | Signal source |
|---|---|
| **Babel** | `babel-plugin-react-compiler` logger (isolated pass) |
| **SWC** | Build scan for `_c(`, `(0,r.c)(N)` / `react_compiler_runtime.c(N)`, memo slots |

**Attribution differs by bundler:**

| Bundler | How components are matched in build output |
|---|---|
| **Webpack** | `;// ./components/Header.tsx` path comments + function names |
| **Turbopack** | Export strings (`"ProductCard"`) + `.c(N)` memo calls (function names are mangled) |

"SWC confirmed" on a webpack `next build` does **not** automatically mean Turbopack
is covered — run `next build --turbopack` and pass the same `--build-dir` to verify.

**SWC honesty rules:**

- No `--build-dir` → **coverage unavailable** (exit 3 on `check`), not a fake Babel number
- Minified build → **coverage unavailable** — rebuild unminified
- Server Components may have **no client memo markers** in RSC bundles → excluded from the SWC denominator with a warning (not counted as silent failures)

Run the ground-truth harness locally:

```sh
npm run test:harness              # webpack only
npm run test:harness:turbopack    # webpack + turbopack comparison
```

**Harness findings (Next 15.5, `experimental.reactCompiler`):**

| Build | ProductCard (client) | Header (server) | Coverage |
|---|---|---|---|
| Webpack minified | no readable markers | no markers | **unavailable** |
| Webpack unminified | `optimized` via path comment + `.c(N)` | silent (excluded) | **100% client (1/1)** |
| Turbopack minified | no readable markers | no markers | **unavailable** |
| Turbopack unminified | `optimized` via `"ProductCard"` + `(0,r.c)(7)` | silent (excluded) | **100% client (1/1)** |

Next client bundles use `(0,r.c)(N)` + `s[N]` memo slots — not Babel's `_c(`.
Turbopack does not emit webpack's `;// ./components/…` comments; export-name
anchors are the reliable attribution path.

**Upstream:** the long-term fix is for SWC/Turbopack to expose compile diagnostics
like the Babel plugin logger. See [docs/upstream-issue-draft.md](docs/upstream-issue-draft.md)
for a draft issue with harness evidence.

### Example output

```
React Compiler Coverage
 Compiler backend: swc
 Coverage: UNAVAILABLE (see warnings below)
────────────────────────────────────────────────────────────────
...
 Warnings:
   · Coverage unavailable: build output is minified…
   · Guessed reactCompiler options from next.config.ts source…
```

When coverage **is** available (Babel projects, or SWC + unminified build scan):

```
 client-component coverage (SWC · webpack): 1/4 optimized (25%)
```

## What gets counted

Components are found with a static AST pass (independent of the compiler logger):

- Function declarations and arrow functions with capitalized names (`Header`)
- Custom hooks (`useSomething`)
- `memo()` / `forwardRef()` / `lazy()` — including multiline wrappers and
  identifier refs (`const X = memo(XImpl)`)
- Class components extending `Component` / `PureComponent`
- Default exports (`export default function Page`)
- Barrel re-exports (`export { Button } from './Button'`, `export { default as Card } from './Card'`)

Files that fail to parse are listed under **Skipped files** and excluded from the
coverage denominator.

## CI gate

`check` exits non-zero when:

| Code | Reason |
|---|---|
| `1` | Component regressed vs baseline, or files were skipped |
| `2` | No components found, or no baseline file |
| `3` | **Coverage unavailable** (SWC without unminified `--build-dir`) |

Regressions that fail the gate:

- Any component drops in health (`optimized → silent`, `optimized → error`, etc.)

Regressions that **don't** fail the gate:

- New `silent` or `skipped` components (common and often intentional)
- Adding `'use no memo'` to an already-silent component (`silent → skipped`)

New components in an **`error`** state always fail — that's an unambiguous break
introduced by the PR.

```sh
# Typical CI workflow (Next.js)
RCC_UNMINIFIED=1 next build
npx react-compiler-coverage check src/components --build-dir .next
```

Use `--allow-skipped` if you expect unparseable legacy files and don't want them
to fail the gate.

See `.github/workflows/coverage.yml` for a ready-to-use workflow.

## Programmatic API

```ts
import { runCoverage, detectCompilerBackend } from 'react-compiler-coverage';

const report = runCoverage('src/components', {
  buildDir: '.next',                              // SWC/Turbopack build output
  compilerOptions: { compilationMode: 'annotation' }, // inline override
  config: './react-compiler.json',                // or JSON file path
});

console.log(report.coverageAvailable); // false on minified SWC builds
console.log(report.coveragePct);       // null when unavailable
console.log(report.coverageLabel);     // e.g. "client-component coverage (SWC · turbopack)"
console.log(report.buildBundler);      // 'webpack' | 'turbopack' | 'unknown'
console.log(report.totals);        // { optimized, error, skipped, silent, total }
console.log(report.backend);       // 'babel' | 'swc' | 'unknown'
console.log(report.skippedFiles);  // parse failures
console.log(report.warnings);      // e.g. missing --build-dir on SWC projects
```

Also exported: `enumerateComponents`, `collectEvents`, `collectEventsFromBuild`,
`detectCompilerBackend`, `loadNextConfig`, `reconcile`, baseline helpers.

## Known limitations

- **Silent ≠ broken.** A silent component may simply have nothing worth memoizing.
- **SWC has no logger.** Turbopack/SWC do not expose `CompileSuccess` events. Build
  scanning is the only honest signal today; see `docs/upstream-issue-draft.md` for
  the upstream ask to expose compile diagnostics in real builds.
- **Client-component slice on App Router.** The headline % covers client components
  with reliable build markers — not Server Components, not the full component tree.
- **Unminified builds required for SWC.** Minified output strips component names;
  coverage is reported as unavailable rather than guessed. Same compiler decisions,
  different labels — worth a dedicated CI build step.
- **Webpack ≠ Turbopack attribution.** Webpack emits path comments; Turbopack uses
  export-name + `.c(N)` anchors. Both work unminified; minified fails for both.
- **Server Components.** RSC bundles often lack client memo markers (`.c(N)`). Those
  components are excluded from the SWC coverage denominator, not misreported as silent.
- **Build scanning is heuristic.** Detects Babel `_c(`, Next `(0,r.c)(N)`, and memo
  slot arrays. Unusual output shapes may not map cleanly.
- **Dynamic patterns.** `React.lazy`, runtime-defined components, unusual HOC chains
  may still be missed.

## Changelog

See [CHANGELOG.md](CHANGELOG.md). Release notes on GitHub are generated from it.

## License

MIT
