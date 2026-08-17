# Upstream issue draft: expose React Compiler diagnostics from SWC/Turbopack builds

Use this as a starting point when filing against **facebook/react** (React Compiler /
SWC integration) and/or **vercel/next.js** (Next.js `reactCompiler` / Turbopack).

---

## Title

Expose React Compiler compile diagnostics from SWC/Turbopack (like `babel-plugin-react-compiler` logger)

## Problem

Tools that report React Compiler **coverage** and CI **regression gates** need per-component
signals: which functions were optimized (`CompileSuccess`), which failed Rules of React
(`CompileError`), and which were explicitly skipped (`CompileSkip`).

The Babel plugin exposes this via its **logger** callback. Next.js 15+ runs the React
Compiler through **SWC**, not Babel — and SWC/Turbopack builds do **not** surface an
equivalent event stream today.

Without upstream support, downstream tools are forced to **infer** optimization by
heuristically scanning build output (memo cache calls like `(0,r.c)(7)`, export names,
webpack path comments). That works only on **unminified** builds and cannot distinguish
"silent because nothing to memoize" from "silent because the compiler gave up."

## Why this matters

- **Honest coverage reporting** for App Router apps using `experimental.reactCompiler`
- **CI gates** that fail on real regressions (`optimized → silent`) without false positives
- **Turbopack adoption** — Turbopack is becoming the default bundler; build-output
  heuristics are a stopgap, not a stable API

## What we have today (evidence from a minimal Next 15.5 harness)

Repo: [react-compiler-coverage](https://github.com/Asuddle/react-compiler-coverage)  
Harness: `test/harness/next-app/` (Header = Server Component, ProductCard = `'use client'`)

| Build | Client component (ProductCard) | Server component (Header) | Tool result |
|---|---|---|---|
| Webpack minified | markers stripped | no client memo slots | `coverageAvailable: false` |
| Webpack unminified | `(0,r.c)(N)` + memo slots in client chunk | no scannable client markers | **100% client (1/1)** |
| Turbopack minified | markers stripped | no client memo slots | `coverageAvailable: false` |
| Turbopack unminified | `"ProductCard"` export + `(0,r.c)(7)` (mangled `function i`) | excluded from denominator | **100% client (1/1)** |

Observations:

1. **SWC does not expose the Babel logger** — confirmed; no compile events from `next build`.
2. **Client bundles use SWC memo runtime**, not Babel's `_c(` — e.g. `(0,r.c)(7)` with `s[0]…s[6]` slots.
3. **Server Components** often have no client memo markers in RSC output — they should not
   be scored as "silent failures" in a client-component coverage metric.
4. **Webpack vs Turbopack attribution differs** — webpack emits `;// ./components/X.tsx`
   comments; Turbopack preserves export strings but mangles function names. Both require
   unminified output for reliable scanning.

Reproduce locally:

```sh
git clone https://github.com/Asuddle/react-compiler-coverage.git
cd react-compiler-coverage
npm install && npm run build
npm run test:harness:turbopack
```

## Proposed solution

Expose compile diagnostics from the SWC React Compiler pass in a **stable, machine-readable**
form during production builds — analogous to the Babel plugin logger:

```ts
type CompileDiagnostic =
  | { kind: 'CompileSuccess'; fnLoc: SourceLocation; memoBlocks?: number }
  | { kind: 'CompileError'; fnLoc: SourceLocation; detail: DiagnosticDetail }
  | { kind: 'CompileSkip'; fnLoc: SourceLocation; reason: string };
```

Possible delivery mechanisms (open to discussion):

1. **Sidecar JSON** written next to build output (`.next/react-compiler-diagnostics.json`)
2. **SWC plugin hook / custom output** consumed by Next.js and forwarded to tooling
3. **Structured warnings** in the build log with stable codes (less ideal for CI)

Requirements:

- Per-function **source locations** (file + line) that map to original TS/JSX
- Events for **success, error, and explicit skip** — not just failures
- Works for **both webpack and Turbopack** SWC pipelines
- Available in **`next build`** (not only dev)

## What downstream tools would do on day one

- Replace build-output heuristics with authoritative per-component status
- Report coverage on **minified production builds** (no special `minimize: false` CI step)
- Distinguish Server vs Client component compile outcomes using compiler knowledge,
  not bundle-shape guessing
- Ship honest CI gates without exit-code workarounds for "unavailable"

## Related

- React Compiler Babel plugin logger (reference behavior)
- Next.js `experimental.reactCompiler` / SWC integration
- Turbopack client chunk format (`t.s(["ExportName", () => impl])`)

## Environment

- Next.js 15.5.x
- `experimental.reactCompiler: true`
- Minimal repro in linked harness above

---

**Suggested filing targets:**

- [facebook/react — Issues](https://github.com/facebook/react/issues) (compiler + SWC pass)
- [vercel/next.js — Issues](https://github.com/vercel/next.js/issues) (Next integration / Turbopack)

Copy the sections above; attach harness log output from `npm run test:harness:turbopack`
as a comment if the issue tracker allows.
