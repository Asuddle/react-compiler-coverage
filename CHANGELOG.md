# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Component triage (Babel logger).** `triage.ts` classifies each component as
  `optimized`, `wont-benefit` (certified fine), `fixable-bail`, `unsupported`, or
  `opted-out` from the full logger stream. Category-aware routing (Todo →
  unsupported; PreserveManualMemo highlighted in CLI).
- **`npm run test:triage`** — 7/7 validation harness against real compiler.
- Baseline v2 stores optional `triage` map; CI fails on `optimized → fixable-bail`,
  warns on `optimized → wont-benefit`. `coveragePct` denominator unchanged.
- **`--strict`** restores the pre-triage CI gate (fail on any health drop,
  including `optimized → silent`).

### Fixed

- **Turbopack attribution.** Detects `(0,r.c)(N)` memo calls (not just `.c(N)`) and
  matches mangled functions via export-name anchors (`"ProductCard"`).
- **Honest SWC handling.** No `--build-dir` or minified builds report coverage as
  unavailable (exit 3) instead of faking Babel simulation numbers.
- **Unminified build scanning.** Detects minified chunks; supports Next client
  bundles (`.c(N)` + `$[slots]`) in addition to Babel `_c(`.
- **Server Component exclusion.** SWC files without reliable build markers are
  excluded from the denominator with a warning.
- **`next.config.ts` guess warning.** Regex fallback emits an explicit warning.
- **Ground-truth harness.** `npm run test:harness` — minimal Next 15 app.

### Changed

- **CI gate is looser on v2 baselines.** `check` no longer fails on
  `optimized → silent` / `wont-benefit` — it warns. That drop is usually a
  legitimate simplification; it can also hide an accidental de-optimization.
  Use `--strict` if your CI depended on the old fail. **v1 baselines (no
  `triage` map) keep the old gate** until you re-run `baseline`.
- **Client-component coverage label.** CLI and report use `coverageLabel` (e.g.
  `client-component coverage (SWC · turbopack)`) so App Router numbers aren't
  misread as whole-app optimization.
- **Bundler detection.** Reports `buildBundler` (`webpack` | `turbopack`) from build output.
- **Harness: turbopack comparison.** `npm run test:harness:turbopack` runs webpack + turbopack builds.
- **Compiler config fidelity.** Reads babel/next config; isolated Babel pass;
  broader enumeration (memo, barrels, HOC refs); skipped-file reporting.

## [0.1.10] - 2026-08-18

### Changed

- **CI publish via npm Trusted Publishing.** Workflow uses OIDC only (no
  `NPM_TOKEN`), compatible with the package's "disallow bypass 2FA tokens"
  setting. Provenance is generated automatically.

## [0.1.9] - 2026-08-18

### Changed

- **CI publish uses Granular NPM_TOKEN.** Classic tokens are removed; workflow
  expects a Granular Access Token with Read+Write and Bypass 2FA enabled.

## [0.1.8] - 2026-08-18

### Changed

- **CI publish: Trusted Publishing only.** Granular tokens now 403 in CI;
  workflow uses OIDC exclusively and strips any `.npmrc` auth lines that
  would block the handshake.

## [0.1.7] - 2026-08-18

### Changed

- **CI publish uses NPM_TOKEN again.** Trusted Publishing requires one-time
  setup on npmjs.com that wasn't configured; switched back to an Automation
  token (`NPM_TOKEN` GitHub secret) with a clear error if it's missing.

## [0.1.6] - 2026-08-18

### Fixed

- **CI publish 404 with Trusted Publishing.** `actions/setup-node`'s
  `registry-url` option writes an empty `_authToken` to `.npmrc`, which makes
  npm skip the OIDC handshake. Removed it so Trusted Publishing can authenticate.

## [0.1.5] - 2026-08-18

### Fixed

- **CI publish on Node 24.** npm Trusted Publishing requires Node 22.14+ and npm
  11.5.1+; the workflow was on Node 20, which caused publish to fail with 404.

## [0.1.4] - 2026-08-18

### Changed

- **CI publish uses npm Trusted Publishing.** The publish workflow now
  authenticates via GitHub OIDC instead of a long-lived `NPM_TOKEN`, fixing
  403 errors from under-permissioned tokens. Provenance is generated
  automatically.

## [0.1.3] - 2026-08-18

### Changed

- **npm package metadata.** Added `repository`, `homepage`, and `bugs` fields so
  the npm page links to GitHub. Fixed the `bin` path format npm expects.

## [0.1.1] - 2026-08-18

### Fixed

- **Preset resolution when run in another project.** Babel resolves preset
  strings relative to the user's project, so `@babel/preset-react` /
  `@babel/preset-typescript` (this package's own dependencies) could not be
  found and every file was skipped with `Cannot find module '@babel/preset-react'`.
  Presets are now resolved to absolute paths from this package.
- **TypeScript files were silently dropped.** `.ts`/`.tsx` files threw on type
  syntax (no TypeScript preset) and were swallowed by the per-file catch. The
  TypeScript preset is now applied for TS files.
- **Silent failures.** A file that fails to parse/transform is now reported to
  stderr instead of vanishing from the coverage denominator with no warning.
- **Nested-component misattribution.** A compiler event is now attributed to the
  narrowest enclosing component, so a component/hook defined inside another is no
  longer credited to the outer one.
- **Error reasons.** `extractReason` no longer falls back to the `severity`
  level (e.g. `"Error"`) as if it were a human-readable message.

### Changed

- **Regression gate covers new components.** A newly added component introduced
  in an `error` state now fails the gate (a Rules-of-React violation is broken
  regardless of history). New `silent`/`skipped` components do not fail.
- **`silent` and `skipped` rank equally.** Adding a deliberate `'use no memo'`
  opt-out to an already-silent component is no longer flagged as a regression.
- **Clear error for the missing peer dependency.** If
  `babel-plugin-react-compiler` isn't installed, the CLI fails once with an
  actionable message instead of reporting every file as skipped.

## [0.1.0] - 2026-08-18

### Added

- Initial release: `report`, `baseline`, and `check` commands; independent AST
  enumeration reconciled against the React Compiler's build-time logger;
  programmatic `runCoverage` API; CI regression gate.
