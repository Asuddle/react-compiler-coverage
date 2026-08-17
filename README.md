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
the compiler's build-time logger, so the denominator is real.

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

Example output:

```
React Compiler Coverage
────────────────────────────────────────────────────────────────
  src/components.jsx
   ? ProductCard              silent
   – LegacyWidget             skipped    · opt-out directive
   ✗ BrokenComponent          error      · Hooks must always be called...
   ✓ Header                   optimized
────────────────────────────────────────────────────────────────
 Coverage: 1/4 optimized (25%)
 optimized:1  error:1  opt-out:1  silent:1
```

## CI gate

`check` exits non-zero when a component drops in health (e.g. `optimized → silent`),
so a PR that quietly breaks the compiler for a component fails the build. It also
fails when a **newly added** component arrives in an `error` state (a Rules-of-React
violation), since that's an unambiguous break introduced by the PR. New `silent`/
`skipped` components don't fail the gate — they're common and often intentional.
`silent` and `skipped` count as equally healthy, so adding a deliberate
`'use no memo'` opt-out to a silent component isn't treated as a regression. See
`.github/workflows/coverage.yml` for a ready-to-use workflow.

## Programmatic API

```ts
import { runCoverage } from 'react-compiler-coverage';

const report = runCoverage('src');
console.log(report.coveragePct, report.totals);
```

## Known limitations (read before relying on this)

- **Silent ≠ broken.** A silent component may simply have nothing worth
  memoizing. This tool reports the bucket; it does **not** yet claim every silent
  component *should* have been optimized. Distinguishing "silent-fine" from
  "silent-should-optimize" is on the roadmap and needs heuristics.
- **Babel path only.** Signal comes from `babel-plugin-react-compiler`'s logger.
  If your build runs the compiler through oxc/SWC without the Babel logger,
  coverage collection won't see events yet. Verify against your build tool.
- **Enumeration heuristic.** Components are detected by capitalized function
  declarations / arrow assignments and `use*` hooks. Exotic definitions may be
  missed.

## License

MIT
