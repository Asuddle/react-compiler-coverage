# Design: non-optimized triage & silent-fine certification

Status: draft · Target: `react-compiler-coverage` (Babel path) · RC version validated: 1.0.0

## TL;DR — the premise changed, read this first

This feature was scoped as "silent-should-optimize detection via
`reportAllBailouts`," reconciling a bailout flag against the logger to find
components the compiler *quietly* declined to optimize.

**Two empirical findings from RC 1.0 invalidate that framing:**

1. `reportAllBailouts` (and its `__unstable_donotuse_*` variants) **does not exist
   in babel-plugin-react-compiler@1.0.0.** The beta flag is gone.
2. In RC 1.0, non-optimized components are almost never *silent*. They emit a
   categorized `CompileError`. The compiler got good enough that a memoizable
   component either succeeds or throws a located, categorized error. The only
   genuinely silent components are the ones with **nothing worth memoizing**.

Validation matrix (isolated Babel pass, default options, no flags):

| Component pattern | Memoized | Event |
|---|---|---|
| derived value in JSX wrapper | yes | `CompileSuccess` |
| bare `.map()` return, inline handler | no | **silent — no events** |
| conditional hook | no | `CompileError(Hooks)` |
| ref write/read during render | no | `CompileError(Refs)` |
| reads `arguments` | yes | `CompileSuccess` |
| `delete o.k` on a prop | no | `CompileError(Immutability)` |
| labeled loop / `continue outer` | yes | `CompileSuccess` |
| param reassignment | yes | `CompileSuccess` |

So "find the hidden silent performance you're leaving on the table" is **not a real
problem in RC 1.0** — the compiler already yells about the fixable cases, and
ESLint surfaces them in-editor. Designing to the beta premise would have produced a
noise machine that flags every nothing-to-memoize component as a problem.

## What the feature actually is

Reframe from "silent diagnosis" to **per-component triage over the full logger
stream**, producing an honest, actionable status for every enumerated component:

| Status | Signal | Actionable? |
|---|---|---|
| `optimized` | `CompileSuccess` | no — working |
| `wont-benefit` | silent: **zero** Success/Error/Diagnostic/Skip events | no — **certified fine** |
| `fixable-bail` | `CompileError` (+ `category`, `reason`, `fnLoc`) | **yes** — has a reason a dev can act on |
| `unsupported` | `CompileDiagnostic` (`category: "Todo"`) | no — compiler limitation, not your code |
| `opted-out` | `CompileSkip` | maybe — remove `'use no memo'`? |

The two genuinely novel contributions — the things no other tool does:

1. **Silent-fine certification.** Proving a component is silent *because there is
   nothing to memoize*, not because it broke. Today a developer sees a component
   ESLint says nothing about and cannot tell "fine" from "unexamined." This tool
   certifies it: compiled, zero diagnostics, nothing to do → stop worrying about it.
2. **App-level aggregation of categorized bails + coverage.** ESLint shows one
   error at a time, in one file, in the editor. This aggregates every bail across
   the app by category, with counts, coverage %, and a CI gate. Different surface,
   different job.

Note what this feature is **not**: it is not net-new detection of Rules-of-React
violations. Those are already caught by `CompileError` and surfaced by
`eslint-plugin-react-hooks`. The value here is triage + certification + aggregation,
not finding errors ESLint misses.

## Algorithm

Single isolated Babel pass per file (we already run it). Extend the logger consumer
to read the full event set, not just `CompileSuccess`.

```
for each file:
  components = enumerate(file)                 # existing AST pass (denominator)
  events     = collect(file)                   # existing logger, now capturing ALL kinds
  for each component c:
    evs = events attributed to c by fnLoc/loc line ∈ c.range
    if any CompileSuccess      -> c.status = 'optimized'
    elif any CompileError      -> c.status = 'fixable-bail'
                                   c.category = err.detail.category      # Refs|Hooks|Immutability|...
                                   c.reason   = err.detail.reason
                                   c.at       = err.fnLoc ?? err.detail.loc
    elif any CompileDiagnostic -> c.status = 'unsupported'
                                   c.reason  = diag.detail.reason        # e.g. "JSX Inlining not supported on value blocks"
    elif any CompileSkip       -> c.status = 'opted-out'
    else                       -> c.status = 'wont-benefit'             # certified silent-fine
```

Precedence matters: a component can emit multiple events (e.g. two `CompileError`s).
Resolve as `optimized > fixable-bail > unsupported > opted-out > wont-benefit`, and
when multiple errors attribute to one component, keep the first by source order and
count the rest.

### Attribution (validated)

`CompileSuccess`, `CompileError`, and `CompileDiagnostic` all carry `fnLoc`
(`{start:{line},end:{line}}`); some errors put the precise location in
`detail.loc`. Attribute by `event.fnLoc?.start.line ?? event.detail?.loc?.start.line`
falling inside a component's `[startLine, endLine]`. Edge: a small number of error
paths emit `fnLoc: null` with location only inside `detail`; fall back to that, and
if neither resolves, attribute to file-level "unattributed bails" rather than
silently dropping.

## Types

```ts
export type TriageStatus =
  | 'optimized' | 'wont-benefit' | 'fixable-bail' | 'unsupported' | 'opted-out';

export interface Diagnosis {
  status: TriageStatus;
  category?: string;   // 'Refs' | 'Hooks' | 'Immutability' | 'Todo' | ...
  reason?: string;     // human-readable, from detail
  at?: { line: number; column?: number };
}
// extend existing ComponentRecord with the Diagnosis fields
```

## Reporting / UX rules

- **Never flag `wont-benefit` as a problem.** It is the correct state for most
  presentational components. Show it as a certified-fine count, not a warning.
  This is the single most important rule — violating it turns the tool into the
  noisy blunt instrument it was meant to beat.
- `fixable-bail` is the only status that should draw attention in the default view,
  grouped by `category` with the reason and location.
- `unsupported` is informational ("compiler can't do this yet"), never the dev's
  fault, never a CI failure.
- Coverage headline stays `optimized / (optimized + fixable-bail + wont-benefit)`;
  exclude `opted-out` and `unsupported` from the denominator (out of scope by
  choice / by compiler limitation, respectively).

## CI integration

- Gate on **`fixable-bail` regressions** (a component moving `optimized ->
  fixable-bail`), reusing the existing baseline-diff machinery. That is an
  unambiguous "you broke the compiler for this component" signal.
- Do **not** gate on `wont-benefit` changes — those are normal refactors.
- Emit the per-category bail counts as a summary so a team can watch trends.

## Scope & limitations (state these loudly in the README)

- **Babel path only.** This relies on the isolated Babel logger's event stream.
  On SWC/Turbopack production builds there is no such stream (see the upstream
  ask). So triage runs against the tool's own Babel pass — accurate for *whether*
  the compiler can optimize a component, but it is the tool's compilation, not the
  app's production build. Document that distinction; do not imply it reflects the
  shipped bundle.
- **Overlaps ESLint for `fixable-bail`.** The errors are the same ones
  `eslint-plugin-react-hooks` reports. The tool's edge is aggregation, coverage
  context, silent-fine certification, and CI gating — not net-new errors.
- **RC version drift.** Event kinds and `detail.category` values are internal-ish
  and may change across compiler versions. Pin the validated version, snapshot the
  category set in a test, and fail loudly on an unknown category rather than
  miscategorizing.

## Is it worth building? (honest verdict)

The grand version of this feature — "surface the hidden silent performance you're
losing" — is mostly a mirage on RC 1.0, because the compiler isn't silent about the
fixable cases. If that was the whole pitch, don't build it.

The modest version is real and still differentiated: **certify the silent-fine set,
aggregate categorized bails with coverage, and gate CI on bail regressions.** No
other tool does silent-fine certification, and none gives an app-level compiler
coverage-plus-triage view. That is worth building — as a 1–2 day extension of the
existing logger consumer, not a week — provided it is scoped and labeled honestly.

### Recommended MVP

1. Capture all event kinds in `collect` (not just success). ~small.
2. Add the triage classifier + precedence + attribution edge handling.
3. Report: coverage headline unchanged; a `fixable-bail`-by-category section;
   a certified `wont-benefit` count; `unsupported` as an info line.
4. CI: extend baseline diff to flag `optimized -> fixable-bail` regressions.
5. Tests: one fixture per status, plus an unknown-category guard.

Explicitly out of scope for MVP: predicting whether a `wont-benefit` component
*could* be refactored to benefit. That is a genuine heuristic research problem and
a separate, riskier feature — do not smuggle it in.
