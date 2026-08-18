# Upstream engagement: CompileSuccess for production build tooling

**Do not file** on facebook/react or vercel/next.js. Engage existing threads with
evidence; a cold issue on the wrong repo risks instant close as duplicate.

---

## Ready-to-post comment (reactwg/react-compiler #79)

Post as a comment on [Tooling: Visual HTML reports for React Compiler (Vite plugin)](https://github.com/reactwg/react-compiler/discussions/79) — closest existing thread on per-component visibility.

```
Sharing real-build evidence on the "how do I know what actually got optimized in
production?" question, since it's adjacent to the tooling here.

I built a small coverage tool + a Next 15.5 harness (webpack and Turbopack, one
Server and one Client component) to test whether per-component optimization status
is recoverable from a real `next build`:

- Minified production builds (default): memo-cache markers are unrecoverable —
  `(0,r.c)(N)` calls and names get mangled/inlined — so per-component attribution
  isn't possible. The tool returns `coverageAvailable: false` instead of a fake
  number.
- Unminified builds: client components are attributable via memo-slot calls +
  export names; coverage is accurate. Server Components carry no client memo
  markers, so they're excluded from the client denominator rather than scored as
  failures.

Repro: `npm run test:harness:turbopack` → https://github.com/Asuddle/react-compiler-coverage

I can see the diagnostics surface is moving fast: the Rust SWC bridge (swc#11917)
forwards diagnostics, swc#11965 adds a `lint`/`lintSync` API to
`@swc/react-compiler`, and oxc#23202 adds a lint-only `react-compiler` rule with
opt-in `reportAllBailouts`. Those cover the violation/bailout side.

The piece coverage tooling still needs — and that I don't see surfaced yet — is the
success side: per-component `CompileSuccess` events (with source locations)
reaching build-tool consumers like `next build`, alongside skip/error. Without the
success signal there's no honest denominator: you can enumerate what failed, not
what was optimized vs. what the compiler silently left alone. A machine-readable
per-build artifact (e.g. sidecar JSON) with the full success/skip/error triple
would let tools drop the bundle-scanning heuristics and report coverage on normal
minified production builds.

Happy to contribute the harness as a repro fixture if useful.
```

**Optional cross-reference:** link this comment from the discussion on
[swc PR #11965](https://github.com/swc-project/swc/pull/11965) (lint API) noting
that lint/bailout coverage ≠ `CompileSuccess` for coverage denominators. Reference
PRs by number and behavior — do not attribute technical direction to named
maintainers in public comments.

---

## Title (if a new reactwg Discussion is ever needed)

Surface per-component `CompileSuccess` from the SWC/Oxc compiler path to build tooling

Not: "Expose React Compiler diagnostics" — that ask gets deflected by lint APIs
already in flight.

---

## Problem

Tools that report React Compiler **coverage** and CI **regression gates** need
per-component signals across three buckets:

| Event | Coverage use |
|---|---|
| `CompileSuccess` | **Denominator + optimized count** — what was actually memoized |
| `CompileError` / bailout | **Actionable failures** — Rules-of-React violations |
| `CompileSkip` | **Explicit opt-out** — `'use no memo'`, suppression, etc. |

The Babel plugin exposes all three via its **logger** callback. An isolated Babel
pass with the plugin wired up has full logger access — `react-compiler-coverage` uses
this today for Babel projects.

**Production Next.js builds do not surface that logger to consumers.** Current
reality (Next 15.5):

1. **SWC eligibility** — Next's SWC layer decides which files need the compiler
   (`isReactCompilerRequired`), avoiding a full-project Babel pass.
2. **Babel transform** — the actual compilation still runs through
   `babel-plugin-react-compiler`, but the logger is not wired into anything
   `next build` exposes to tooling.
3. **Rust/SWC-native path in flight** — [swc #11917](https://github.com/swc-project/swc/pull/11917)
   (by magic-akari) adds the `swc_ecma_react_compiler` bridge, SWC ↔ React Compiler
   AST conversion, `.swcrc` `jsc.transform.reactCompiler`, and **diagnostics
   forwarding** — pending published Rust crates. This is progress, but what is
   landing upstream today is predominantly the **lint/violation** side, not the
   **success** side coverage tooling needs.

Without `CompileSuccess` reaching build consumers, downstream tools are forced to
**infer** optimization by heuristically scanning bundle output (memo cache calls
like `(0,r.c)(7)`, export names, webpack path comments). That works only on
**unminified** builds and cannot distinguish "silent because nothing to memoize"
from "silent because the compiler gave up."

---

## Why lint APIs don't close the gap

Recent upstream work covers violations and bailouts — not optimization success:

| Work | What it surfaces |
|---|---|
| [swc #11965](https://github.com/swc-project/swc/pull/11965) — `lint` / `lintSync` on `@swc/react-compiler` | Rules-of-React violations, lint diagnostics |
| [oxc #23202](https://github.com/oxc-project/oxc/pull/23202) — `react-compiler` lint rule | Lint-only mode; opt-in `reportAllBailouts` for bailouts |
| [swc #11917](https://github.com/swc-project/swc/pull/11917) — Rust SWC bridge | Diagnostics forwarding; full compiler integration in progress |

These answer **"what failed / bailed out?"** Coverage tooling also needs
**"what succeeded?"** — per-component `CompileSuccess` with source locations —
or there is no honest denominator.

---

## Harness evidence (Next 15.5, `experimental.reactCompiler`)

Repo: [react-compiler-coverage](https://github.com/Asuddle/react-compiler-coverage)  
Harness: `test/harness/next-app/` (Header = Server Component, ProductCard = `'use client'`)

| Build | Client component (ProductCard) | Server component (Header) | Tool result |
|---|---|---|---|
| Webpack minified | markers stripped | no client memo slots | `coverageAvailable: false` |
| Webpack unminified | `(0,r.c)(N)` + memo slots in client chunk | no scannable client markers | **100% client (1/1)** |
| Turbopack minified | markers stripped | no client memo slots | `coverageAvailable: false` |
| Turbopack unminified | `"ProductCard"` export + `(0,r.c)(7)` (mangled `function i`) | excluded from denominator | **100% client (1/1)** |

Observations:

1. **Logger exists in Babel; production build doesn't expose it.** Isolated Babel +
   plugin = full logger. `next build` = no per-component event stream to consumers.
   Rust bridge adds diagnostics forwarding, scoped to lint/violations today.
2. **Client bundles use SWC memo runtime**, not Babel's `_c(` — e.g. `(0,r.c)(7)`
   with `s[0]…s[6]` slots.
3. **Server Components** often have no client memo markers in RSC output — excluded
   from client-component coverage denominator, not scored as silent failures.
4. **Webpack vs Turbopack attribution differs** — webpack emits `;// ./components/X.tsx`
   comments; Turbopack preserves export strings but mangles function names. Both
   require unminified output for bundle-scanning heuristics.

Reproduce:

```sh
git clone https://github.com/Asuddle/react-compiler-coverage.git
cd react-compiler-coverage
npm install && npm run build
npm run test:harness:turbopack
```

---

## Proposed ask (aligned with in-flight port)

As the Rust/SWC-native (and Oxc) compiler path matures, surface the **full logger
event triple** to build-tool consumers — not just lint diagnostics:

```ts
type CompileEvent =
  | { kind: 'CompileSuccess'; fnLoc: SourceLocation; memoBlocks?: number; /* … */ }
  | { kind: 'CompileError'; fnLoc: SourceLocation; detail: DiagnosticDetail }
  | { kind: 'CompileSkip'; fnLoc: SourceLocation; reason: string };
```

The **differentiator** of this ask is `CompileSuccess` reaching `next build` (and
similar bundlers) — skip/error alone cannot support coverage denominators.

Possible delivery (open to discussion):

1. **Sidecar JSON** per build (e.g. `.next/react-compiler-events.json`)
2. **Transform/lint API returning upstream `CompileResult` logger JSON** (swc #11965
   discussion already points at returning serializable upstream types rather than
   parallel SWC models — extend that to success events in build mode)
3. Bundler forwarding layer (Next/Turbopack) passing events to CI tooling

Requirements:

- Per-function **source locations** (file + line) mapping to original TS/JSX
- **`CompileSuccess` in addition to skip/error** — required for coverage
- Available in **`next build`** on **minified** production output (no special
  `minimize: false` CI step)

---

## What downstream tools would do on day one

- Replace bundle-scanning heuristics with authoritative per-component status
- Report **client-component coverage** on normal minified production builds
- Distinguish Server vs Client compile outcomes using compiler knowledge
- Ship honest CI gates without `coverageAvailable: false` workarounds

---

## Where to engage (not fresh-file targets)

| Venue | Action |
|---|---|
| [reactwg/react-compiler #79](https://github.com/reactwg/react-compiler/discussions/79) | **Primary** — comment with harness evidence (see above) |
| [swc PR #11965](https://github.com/swc-project/swc/pull/11965) | Cross-reference: lint API ≠ `CompileSuccess` for coverage |
| [swc #11697](https://github.com/swc-project/swc/issues/11697) | Parity work — logger event types already in crate surface |
| [swc #11751](https://github.com/swc-project/swc/issues/11751) | Closed — landed in #11917; don't re-file |

**Do not** open fresh issues on facebook/react or vercel/next.js for this ask.

---

## In-repo work that doesn't wait on upstream

The upstream comment is cheap and worth posting. The differentiator that makes people
care beyond a number — **silent-fine vs. silent-should-optimize** — is entirely
in-repo:

- Isolated Babel logger → `CompileSuccess` / `CompileError` / `CompileSkip`
- `reportAllBailouts` / eslint `react-hooks/todo` → bailout reasons for silent components
- Reconcile the two → actionable "this component should have optimized but didn't"

See silent-diagnosis design (TBD) — that path is under our control today.
