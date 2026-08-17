# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
