# Design: distributing the east-c runner via npm (and runner availability in scaffolded projects)

## Goal

A developer who scaffolds a project with `npm create @elaraai/e3` (or `@elaraai/east`)
should be able to execute East tasks with any of the three runners —
**east-node**, **east-py**, **east-c** — by adding them as ordinary project
dependencies, with no manual binary downloads, no `PATH` fiddling, and no
platform-specific instructions. This document covers how the **east-c** runner
is delivered through npm (the missing piece), plus the supporting changes to the
e3 templates and `e3-core` so all three runners resolve.

It is *not* about east-py packaging (that is irreducibly Python — see "Out of
scope" — and is solved separately via a uv index).

## Background / current state

Three runners exist; their delivery channels differ:

| Runner | CLI bin | Today | Resolvable in a scaffolded project? |
|---|---|---|---|
| east-node | `east-node` | `@elaraai/east-node-cli` on npm | yes — add as devDep |
| east-py | `east-py` | `elaraai-east-py-cli` on PyPI (via uv venv) | yes — via `uv run east-py` |
| east-c | `east-c` | **GitHub Release tarballs only** (`east-c-<ver>-<target>.tar.gz`) | **no** |

So east-c is the gap: it is a native binary distributed only as release tarballs,
which a project cannot pull through `npm install`. The e3 `e3.task` **default
runner is east-py** (`['east-py','run','-p','east-py-std','-p','east-py-io','-p','east-py-datascience']`),
so this design does not change default behaviour — it makes east-c *available*
so it can be selected as a runner.

`publish-c-native` (in `.github/workflows/release.yml`) already builds the
`east-c` binary for four targets and uploads tarballs:

- `linux-x64` (ubuntu-latest)
- `linux-arm64` (ubuntu-24.04-arm)
- `macos-arm64` (macos-14)
- `macos-x64` (macos-14, `-DCMAKE_OSX_ARCHITECTURES=x86_64`)

There is **no Windows target**, and the C build currently relies on
zlib/bzip2/pcre2 being discoverable (pcre2 is fetched via `FetchContent`;
zlib/bzip2 are found from the system on Linux/macOS) — none of which hold on a
bare Windows runner.

## Design: the esbuild "launcher + per-platform optional-deps" model

This is the well-trodden pattern used by esbuild, swc, biome, and others for
shipping native binaries through npm.

### Packages

- **`@elaraai/east-c-cli`** — the *launcher*. A tiny JS package, **no binary**.
  - `bin`: `{ "east-c": "./bin/east-c.mjs" }`
  - `optionalDependencies`: each per-platform package, pinned to the exact same
    version (lockstep).
- **`@elaraai/east-c-cli-<platform>`** — one per target, each containing **only**
  that platform's `east-c` binary.
  - `os` / `cpu` fields gate installation so npm/pnpm installs *only* the one
    matching the host; the rest are skipped.
  - Platforms (npm `${process.platform}-${process.arch}`):
    `linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`, `win32-x64`.

Naming mirrors the existing `@elaraai/east-node-cli` (keep the `-cli` suffix; it
also disambiguates from the `east-c` *library* package).

### Version & platform resolution

- **Version:** `set-npm-version.mjs` bumps the launcher + all platform packages
  together; the launcher's `optionalDependencies` pin the platform packages to
  its own exact version. Lockstep, no templating. A scaffolded project just
  depends on `@elaraai/east-c-cli@^<release>`.
- **Platform (install):** npm honours `os`/`cpu` on the optional deps and
  installs only the matching one.
- **Platform (runtime):** the launcher resolves
  `@elaraai/east-c-cli-${process.platform}-${process.arch}`, finds the binary via
  `require.resolve`, and `spawn`s it with the passed argv (stdio inherited). On
  an unsupported platform it exits with a clear "no prebuilt east-c for X-Y"
  message.

The binary runs as a normal native OS process — Node only locates and spawns it
(esbuild-style); there is no FFI/embedding and no Node performance constraint.

### Launcher sketch (`bin/east-c.mjs`)

```js
#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkg = `@elaraai/east-c-cli-${process.platform}-${process.arch}`;
let bin;
try { bin = require.resolve(`${pkg}/east-c${process.platform === "win32" ? ".exe" : ""}`); }
catch { console.error(`east-c: no prebuilt binary for ${process.platform}-${process.arch} (${pkg})`); process.exit(1); }
process.exit(spawnSync(bin, process.argv.slice(2), { stdio: "inherit" }).status ?? 1);
```

## Windows east-c build (prerequisite for the win32-x64 package)

The new `win32-x64` target needs the C build to work under MSVC on a
`windows-latest` runner. Known issues from a trial run:

- **Missing system libs:** `Could NOT find BZip2`, `Could NOT find ZLIB`.
- **Feature probes failing** under MSVC (`HAVE_REALPATH`, `HAVE_BUILTIN_MUL_OVERFLOW`,
  `HAVE_VISIBILITY`, etc.) — expected; the code must have MSVC fallbacks (it has
  `windows.h` paths already).
- **pcre2** is fetched via `FetchContent` (works cross-platform).

Options for zlib/bzip2 on Windows, in order of preference:
1. **Vendor them via `FetchContent`** (same mechanism already used for pcre2) so
   the build is self-contained on every OS — preferred, no external package
   manager, consistent with current approach.
2. **vcpkg** on the Windows runner — works but adds a toolchain dependency and CI
   setup.
3. **Make zlib/bzip2 optional** if east-c can build without them (depends on
   whether the compression features are needed in the CLI runner) — smallest
   change if viable.

Decision needed during implementation: confirm whether the `east-c` CLI runner
actually requires zlib/bzip2, or whether they can be optional for the runner
build. If required, go with FetchContent (option 1).

CMake invocation on Windows differs (MSVC generator, `.exe` suffix,
`--config Release`); the `publish-c-native` build step needs a Windows branch.

## Release wiring (`publish-c-native` → npm)

Extend the existing job rather than replace it:

1. **Add the `win32-x64` matrix entry** (`windows-latest`, MSVC) once the build
   is fixed; keep the existing four targets.
2. After building the binary for a target, **pack a per-platform npm package**:
   stage `bin/east-c[.exe]` + a generated `package.json` (name
   `@elaraai/east-c-cli-<platform>`, version from the bump artifact, `os`/`cpu`,
   `files: ["east-c*"]`), and upload it as a build artifact (alongside the
   existing tarball, which stays for non-npm consumers).
3. A new **`publish-c-npm`** step/job (gated like the others) publishes the
   launcher `@elaraai/east-c-cli` + all `@elaraai/east-c-cli-<platform>`
   packages, with provenance, via `scripts/publish-npm.mjs`.
4. **`set-npm-version.mjs`, `publish-npm.mjs`, `check-version-drift.mjs`**: add
   the launcher + the five platform packages (or generate the platform
   `package.json`s at build time and only track the launcher in the version
   scripts — see "Open questions").
5. The launcher package source lives in the repo (e.g.
   `libs/east-c/packages/east-c-cli-npm/`); the per-platform packages are
   **generated at release time** from the built binaries (their only content is
   one binary + a templated manifest), so they are not committed.

## e3 template + e3-core integration

1. **e3 template devDeps**: add `@elaraai/east-node-cli` and `@elaraai/east-c-cli`
   (as `workspace:*`, rewritten to `^<version>` on emit) so `east-node` and
   `east-c` land on `node_modules/.bin`. (`east-py` continues via the uv venv.)
2. **Runner selection**: leave the sample task on the default for now (per
   current decision); a later change lets the scaffold pick the runner. The
   point of this design is *availability*, not changing the default.
3. **`e3-core` `LocalTaskRunner` PATH augmentation**: prepend the workspace's
   `node_modules/.bin` to the spawned runner's `PATH`, so `east-node` / `east-c`
   resolve whether the dataflow is launched via an npm script *or* a bare global
   `e3`. Without this, runners only resolve when invoked through `npm run`.

## Testing

- **Per-platform smoke** in CI (ubuntu / macos-14 / windows-latest): install
  `@elaraai/east-c-cli` from the built packages and run `east-c --version`;
  assert it resolves the matching platform package and execs.
- **Launcher unit test**: unsupported-platform path errors cleanly.
- Fold an east-c-runner exercise into the create e2e once the packages publish
  (scaffold → `npm install` → run a task with the east-c runner).

## Out of scope

- **east-py via npm**: not pursued — east-py needs a Python interpreter +
  Python packages; bundling a Python runtime into npm reinvents Python
  packaging. east-py stays a Python package; PyPI throttling is addressed
  separately (uv alternate index / official publish action).
- Changing the e3 default runner.

## Decisions (resolved)

1. **Windows zlib/bzip2:** first check whether the CLI runner actually needs
   them; if it does, **vendor via `FetchContent`** (same mechanism as pcre2 —
   self-contained, no external toolchain). Make them optional only if the runner
   genuinely doesn't use them.
2. **Per-platform packages:** **generate each platform `package.json` at release
   time** from the built binary; only the launcher `@elaraai/east-c-cli` is
   tracked in `set-npm-version` / `publish-npm` / `check-version-drift`.
3. **Windows arch:** **`win32-x64` only** for the first version; defer
   `windows-arm64` (no commonly-available hosted runner).
4. **First publish of the new npm names:** `@elaraai/east-c-cli` and the five
   `@elaraai/east-c-cli-<platform>` names are brand-new. Bootstrap them with a
   **manual first publish** (scoped npm token, as done for the `create-*`
   packages) to establish the names + allow trusted-publishing config; CI
   publishes versions thereafter. The launcher's `optionalDependencies` must
   reference platform-package versions that exist, so publish the platform
   packages before (or together with) the launcher in the bootstrap.

## Suggested PR sequencing

1. **east-c Windows build** — fix CMake/deps so `cmake --build` produces
   `east-c.exe` on `windows-latest`; add the `win32-x64` target to
   `publish-c-native` (tarball only at first). Self-contained, verifiable.
2. **east-c-cli npm packaging** — launcher package + per-platform manifest
   generation + `publish-c-npm` + version/publish/drift wiring.
3. **Template + e3-core** — add east-node-cli/east-c-cli devDeps to the e3
   template; `LocalTaskRunner` PATH augmentation; create e2e exercise.
