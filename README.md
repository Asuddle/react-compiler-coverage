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
| `--build-dir <path>` | Build output dir (`.next`, `dist`, `build`) for SWC/Turbopack fidelity |
| `--allow-skipped` | Don't fail `check` when files couldn't be parsed |

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

`next.config.ts` is loaded via tsx/esbuild when available in your project; otherwise
the tool falls back to parsing `reactCompiler` from the source.

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

Next.js runs the React Compiler through SWC by default — not through Babel's logger.
For production-accurate results, build first and point at the output:

```sh
next build
npx react-compiler-coverage report src --build-dir .next
```

The tool auto-detects the compiler backend (`babel` vs `swc`) and:

- **Babel projects** — uses `babel-plugin-react-compiler`'s logger directly
- **SWC projects** — reads `_c(` / `react/compiler-runtime` markers from compiled
  chunks in `--build-dir`; error and opt-out detection still uses an isolated Babel pass

If you're on SWC and skip `--build-dir`, you'll get a warning and Babel-only results.

### Example output

```
React Compiler Coverage
 Compiler backend: swc (use --build-dir for production fidelity)
────────────────────────────────────────────────────────────────

  src/components.jsx
   ? ProductCard              silent
   – LegacyWidget             skipped    · 'use no memo' opt-out
   ✗ BrokenComponent          error      · Hooks must always be called...
   ✓ Header                   optimized

────────────────────────────────────────────────────────────────
 Coverage: 1/4 optimized (25%)
 optimized:1  error:1  opt-out:1  silent:1

 Skipped files: 1/12 (not counted in coverage)
   src/legacy/broken-syntax.jsx  · Unexpected token

 Warnings:
   · Project uses SWC/Turbopack for the React Compiler. Run a production build and pass --build-dir .next for accurate results.
────────────────────────────────────────────────────────────────
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
| `1` | A component regressed vs baseline (e.g. `optimized → silent`), or files were skipped |
| `2` | No components found, or no baseline file exists |

Regressions that fail the gate:

- Any component drops in health (`optimized → silent`, `optimized → error`, etc.)

Regressions that **don't** fail the gate:

- New `silent` or `skipped` components (common and often intentional)
- Adding `'use no memo'` to an already-silent component (`silent → skipped`)

New components in an **`error`** state always fail — that's an unambiguous break
introduced by the PR.

```sh
# Typical CI workflow
npx react-compiler-coverage baseline src/components   # once, commit .react-compiler-coverage.json
next build
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

console.log(report.coveragePct);   // 25
console.log(report.totals);        // { optimized, error, skipped, silent, total }
console.log(report.backend);       // 'babel' | 'swc' | 'unknown'
console.log(report.skippedFiles);  // parse failures
console.log(report.warnings);      // e.g. missing --build-dir on SWC projects
```

Also exported: `enumerateComponents`, `collectEvents`, `collectEventsFromBuild`,
`detectCompilerBackend`, `loadNextConfig`, `reconcile`, baseline helpers.

## Known limitations

- **Silent ≠ broken.** A silent component may simply have nothing worth memoizing.
  This tool reports the bucket; it does not yet claim every silent component
  *should* have been optimized.
- **SWC needs a build.** `--build-dir` scans compiled chunks for `_c(` markers.
  Without a production build, SWC projects fall back to Babel simulation.
- **Build scanning is heuristic.** It matches source paths and function names in
  bundles; heavily transformed or code-split output may not map cleanly.
- **Dynamic patterns.** `React.lazy(() => import('./Page'))`, runtime-defined
  components, and unusual HOC chains may still be missed.

## Changelog

See [CHANGELOG.md](CHANGELOG.md). Release notes on GitHub are generated from it.

## License

MIT
