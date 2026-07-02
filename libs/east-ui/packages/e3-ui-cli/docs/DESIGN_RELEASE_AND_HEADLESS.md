# e3-ui-cli: release integration, headless robustness, template + skill wiring

Design for making `@elaraai/e3-ui-cli` a first-class published package: in the
release pipeline, installable by devs on headless Ubuntu servers (and Windows /
macOS) without the usual Playwright pain, optionally scaffolded by
`npm create @elaraai/e3`, and documented as a plugin skill.

This is the post-review revision: the original design went through a
multi-agent adversarial review (5 lenses, every finding independently
verified); all confirmed findings are folded in below.

## Current state (verified)

- `@elaraai/e3-ui-cli@1.0.28` builds/tests/lints green in the monorepo; bin
  (`e3-ui` → `bin/e3-ui.mjs`, shebang, dynamic import of `dist/cli.js`),
  engines node>=22 — matching the e3-cli publishing pattern. `files` whitelist
  is `bin, dist (minus *.spec.*), README.md, LICENSE.md, CONTRIBUTING.md,
  CLA.md` — `docs/` (this design doc) is deliberately NOT shipped.
  `npm pack --dry-run`: ~2.1 MB, includes the full `dist/app` Vite bundle.
- **Not on npm** (`npm view` → 404). Root cause: `scripts/publish-npm.mjs`
  `PKGS` array does not list it. It IS already in `set-npm-version.mjs`,
  `check-version-drift.mjs`, the `finalize` drift gate, `version-drift.yml`,
  `test-east-ui.yml` paths, and the east-ui `make build` chain. The verdaccio
  dry-run (`scripts/test-release-verdaccio.sh`) publishes via publish-npm.mjs,
  so it inherits the same miss.
- Rendering is Playwright-only: `dependencies: { playwright: ^1.49 }`
  (lockfile resolves 1.59.1 workspace-wide), `chromium.launch({ headless:
  true })` in `src/capture.ts`. Pain on headless servers: ~262 MB postinstall
  browser download, missing apt libs, snap-chromium traps, stale
  `npx playwright install chromium` remediation text.
- Workspace runtime deps are all published: `@elaraai/e3-api-server` (dep) and
  `@elaraai/east` (peer) — pnpm rewrites `workspace:*` to the exact version in
  both fields at publish (verified against published siblings).
- Playwright fact-base (verified against playwright-core@1.59.1 sources):
  - `chromiumSandbox` defaults to **false** — playwright always launches
    Chromium with `--no-sandbox` unless the caller opts the sandbox ON. So
    root/AppArmor sandbox failures cannot happen via `chromium.launch()`, and
    the existing `E3_UI_NO_SANDBOX` env (passing `chromiumSandbox: false`) is
    a no-op.
  - `--disable-dev-shm-usage` is already a playwright default switch.
  - Bare `chromium.launch({ headless: true })` selects the
    `chromium-headless-shell` build when installed; `chromium.executablePath()`
    always returns the FULL chromium path and must never be fed back into
    `launch()` after an `--only-shell` install.
  - `playwright-core` has no `./cli` export subpath; `cli.js` exists at the
    package root (resolve via `playwright-core/package.json`).
  - The in-repo snapshot pipeline (`libs/east-ui/scripts/snapshot-capture.mts`)
    launches with `--no-sandbox --disable-gpu`; adding `--disable-gpu` here
    INCREASES pixel parity.
- create-e3 template: single source of truth `libs/create/templates/e3`
  (`packages/create-e3/templates/` is a gitignored build artifact re-copied by
  `build.mjs` on every build — no sync/drift mechanism exists or is needed).
  The `ui` feature (`default: false`) gates `src/ui/index.tsx` + deps. The UI
  entry exports `surface = ui("surface", [], East.function(...))`.
- `ui()` returns a plain e3 `TaskDef`: the original East function is NOT
  retained; `task()` eagerly stores `fn.toIR()` (the full EastIR bundle,
  source map included) as `inputs[0].default` (dataset name `function_ir`).
  `TaskDef.command` is ALSO an EastIR (the argv builder) — never unwrap that.
- Plugin: skills are directories under `libs/east-claude-plugin/skills/`;
  lib-backed skills are a real dir + `SKILL.md` symlink into the lib. The
  plugin-artifacts workflow triggers on `libs/**/SKILL.md` changes but only
  fails on an `index.json`/`.build/` diff — a skill with no examples cannot
  break it. `e3` precedent: hand-written `index.static.json` stubs make an
  API searchable without `*.examples.ts`.
- Sibling dist-tags: `latest: 1.0.28`; `@elaraai/e3-ui` has no `beta` tag.
- Local `~/.npmrc` has a temporary npm token (whoami 401 is expected for a
  granular publish-scoped token). CI publishes carry `--provenance`; a local
  publish cannot (accepted, superseded at next CI release).

## 1. Release pipeline sync

**1a.** Add `'libs/east-ui/packages/e3-ui-cli/package.json'` to `PKGS` in
`scripts/publish-npm.mjs`, after `e3-ui-components` (topologically valid: its
only published runtime dep, `e3-api-server`, is earlier). This makes CI
publish it on every release (beta + latest) and the verdaccio validate-release
dry-run publish it; the already-published guard keeps retries idempotent.

**1b.** In `scripts/test-release-verdaccio.sh`, add
`"@elaraai/e3-ui-cli": "$VERSION"` to the smoke consumer's dependencies AND
append `&& e3-ui --version` to its `smoke` script — install alone only creates
the `.bin` symlink; running `--version` proves the whole module graph
(bin shim → dist/cli.js → commander/esbuild/playwright-core/e3-api-server)
loads. Browser-free: importing playwright-core launches nothing. Set
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` on the consumer `npm install` as a
belt-and-braces guard.

No other release tooling changes needed (version bump, drift check, CI
build/test already cover the package).

## 2. Headless robustness

Research conclusion: nothing but Chromium renders a real React + Chakra v3 +
Emotion + canvas app pixel-accurately (Lightpanda has no rendering engine;
Servo/Ladybird not production-ready; WebKit diverges visually). The fix is to
make acquiring and launching Chromium boring: lightweight install,
deterministic resolution, self-diagnosis.

**2a. `playwright` → `playwright-core`, pinned `~1.59.0`.** Same API (pure
import-specifier swap — capture.ts:24 is the only import), no postinstall
browser download on `npm install -g`. Pin the tilde range because browser
revisions are keyed to the playwright-core minor: a `^` range would let a CLI
reinstall silently invalidate the previously installed headless shell. 1.59
matches what the workspace lockfile already resolves for the sibling
devDeps — no dedup split. Requires `pnpm install` and a **committed
pnpm-lock.yaml** (locally, hoisting masks a missing install; CI's
frozen-lockfile `pnpm install` does not). Note: the install is *lighter*, not
tiny — the runtime `esbuild` dep still ships its ~10 MB platform binary.

**2b. Browser resolution + launch cascade** (in a new `src/browser.ts`):
1. `E3_UI_CHROMIUM_PATH` then `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` → launch
   with that `executablePath` (existing contract, unchanged).
2. Bare `chromium.launch({ headless: true, args: ['--disable-gpu'] })` — no
   `executablePath` — so playwright-core resolves the managed cache itself
   (headless shell or full build, whichever is present; respects
   `PLAYWRIGHT_BROWSERS_PATH` for shared server-fleet caches). NEVER call
   `chromium.executablePath()` for this.
3. On a missing-executable failure, fall through to system browsers, per
   platform:
   - Linux: `/opt/google/chrome/chrome`, `/usr/bin/google-chrome-stable`,
     `/usr/bin/chromium`, `/usr/bin/chromium-browser` — but **reject snap
     shims**: skip a candidate whose realpath resolves under `/snap/` or whose
     file starts with `#!` (on Ubuntu, `/usr/bin/chromium-browser` IS a shell
     script exec-ing the snap; snap confinement breaks automation).
   - Windows: Chrome under `%ProgramFiles%`, `%ProgramFiles(x86)%`,
     `%LocalAppData%`, then Edge (`msedge.exe`, Chromium-family).
   - macOS: `/Applications/Google Chrome.app/...`, Chromium.app, Edge.app.
4. Nothing found → one actionable error naming `e3-ui install-browser
   [--with-deps]`, `E3_UI_CHROMIUM_PATH`, and `e3-ui doctor`.

Candidate-list building is a pure function of `platform` + env (unit-tested
for all three OSes); shim detection is tested against temp files. No sandbox
handling at all: playwright's default is sandbox-off (`--no-sandbox`), which
is correct for rendering trusted local components. `E3_UI_NO_SANDBOX` (a
no-op today) is removed from code and README — the package has never been
published, so nothing can depend on it.

**2c. `e3-ui install-browser` subcommand.** Resolves the playwright-core CLI
as `path.join(path.dirname(require.resolve('playwright-core/package.json')),
'cli.js')` (there is no exported `./cli` subpath) and spawns
`process.execPath <cli.js> install --only-shell [--with-deps] chromium` with
inherited stdio. `--only-shell` fetches only `chromium-headless-shell`
(~101 MB vs ~262 MB, no X11/D-Bus libs) — coherent with 2b's bare launch,
which selects the shell when headless. `--with-deps` (apt/dnf system libs) is
passed through on Linux; accepted-but-skipped with a note on Windows/macOS
(no system libs needed). Version-matched to the bundled playwright-core by
construction. Respects `PLAYWRIGHT_BROWSERS_PATH`.

**2d. `e3-ui doctor` subcommand.** Prints the env-override state, then runs
the exact 2b launch cascade against `about:blank`, reporting which source
succeeded (managed cache / system browser at path / env override) or, on
failure, per-OS remediation. Also detects the revision-drift case
(playwright-core upgraded, old shell revision missing → "Executable doesn't
exist" → prescribe re-running `e3-ui install-browser`).

**2e. Error-message hygiene.** capture.ts's launch-failure message currently
says `npx playwright install chromium` — after the migration that would
download the full `playwright` package ad hoc (wrong version, wrong weight).
Replace it (and the README lines) with `e3-ui install-browser` + `e3-ui
doctor`. The shot launch error and doctor share the same remediation text.

**2f. Cross-platform (Windows / macOS / Linux).** Covered by 2b's per-OS
candidate lists and 2c's `--with-deps` gating; the CLI spawn uses
`process.execPath` + an absolute script path (no shell, no `.cmd` shims). No
POSIX-only path handling anywhere (`node:path` throughout, already true).

**2g. README rewrite** for server installs: global install (now light),
one-time `e3-ui install-browser --with-deps`, shared
`PLAYWRIGHT_BROWSERS_PATH` for fleets, doctor-first troubleshooting, explicit
"don't use snap chromium" note, Windows/macOS notes, and the Docker option
(`mcr.microsoft.com/playwright` or a trimmed `--only-shell` image) for
isolation-first deployments.

Tests stay browser-free: unit tests for candidate-list building and snap-shim
detection, plus the existing parser/payload suites.

## 3. Dev installability

With §2: `npm i -g @elaraai/e3-ui-cli` is a fast install anywhere; first
`shot` without a browser fails with an actionable message;
`e3-ui install-browser --with-deps && e3-ui doctor` is the whole server
setup. No `postinstall` script (deliberate — quiet installs).

## 4. create-e3 template (riding the existing `ui` option)

No new prompt — when `ui` is selected the scaffold also wires the screenshot
tool. **Edit `libs/create/templates/e3/` only** (the packaged copy under
`packages/create-e3/templates/` regenerates on every build).

- `template.json` `ui` feature gains `"devDependencies":
  ["@elaraai/e3-ui-cli"]` and `"scripts": ["shot"]` (the manifest interpreter
  already supports both fields with pruning).
- Template `package.json` gains the devDep (`workspace:*`, rewritten to
  `^<version>` at scaffold time) and
  `"shot": "e3-ui shot --from-source src/ui/index.tsx --export surface -o surface.png"`.
- **CLI contract fix** in `load-source.ts`: `asEastFunction` gains a
  dependency-free structural unwrap for e3 `ui()` tasks —
  `value.kind === 'task' && value.taskKind === 'ui' &&
  Array.isArray(value.inputs) && value.inputs[0]?.name === 'function_ir' &&
  value.inputs[0].default != null` → return
  `{ toIR: () => value.inputs[0].default }` (that default IS the original
  `fn.toIR()` bundle, source map included — perfect round-trip). Target
  `inputs[0]`/`function_ir` specifically; `TaskDef.command` is also an EastIR
  and must never be unwrapped. Reject ui tasks with compute-time inputs
  (`inputs.length > 1`) with a clear "render via --from-task against a
  deployed workspace" error — `decodeEastIR` does not check arity, so an
  unguarded parameterized surface would fail confusingly in the browser.
- scaffold-core spec additions: ui-on asserts
  `devDependencies["@elaraai/e3-ui-cli"] === "^<version>"` and `scripts.shot`
  present; ui-off/default asserts both absent (mirrors the eslint on/off
  pair).
- Template README's UI section mentions `npm run shot`.
- **Release coupling**: §4 requires §1a in the same (or an earlier) release —
  a `--ui` scaffold pins `@elaraai/e3-ui-cli@^<create-e3's version>`, which
  must exist on npm. Both land in this one PR, so every future release train
  satisfies it.

## 5. SKILL.md + plugin + registry fan-out

- New `libs/east-ui/packages/e3-ui-cli/SKILL.md`, modelled on
  `libs/e3/SKILL.md` per `docs/conventions/SKILLS_STANDARD.md`: frontmatter
  (`name: e3-ui-cli`, trigger-listing description), Quick Start, Decision
  Tree, CLI reference (shot / install-browser / doctor), programmatic API
  table (`renderToPng`, `renderTaskToPng`, `capture`, `buildPayload`,
  `loadComponentFromSource`, `startRepoServer`), headless-server setup,
  Related skills (east-ui, e3-ui, e3, east-project).
- Examples discoverability: follow the **e3 precedent** — add a few
  hand-written `index.static.json` entries (shot from source / from task /
  programmatic render) rather than a `*.examples.ts` suite (the CLI surface
  is not East-expression code). Run `make index` in the plugin and commit
  `index.json` (plugin-artifacts fails on a diff otherwise). Record this as
  an explicit, reasoned deviation from the standard's examples mandate.
- Plugin: `skills/e3-ui-cli/` real directory + `SKILL.md` symlink →
  `../../../east-ui/packages/e3-ui-cli/SKILL.md`.
- Registry fan-out (all the places that enumerate packages/skills):
  - `libs/east-claude-plugin/README.md` — Skills table row; also fix the
    stale `update-skills` workflow name → `plugin-artifacts`.
  - Root `CLAUDE.md` — plugin-skills list (`east:e3-ui-cli` + SKILL.md path
    bullet) AND the repo-layout east-ui line (add e3-ui-cli).
  - `libs/east-ui/CLAUDE.md` — Packages table (e3-specific UI) + the
    "Plugin skills" section (add e3-ui-cli; add the missing e3-ui entry in
    passing).
  - `skills/east-contribute/SKILL.md` — triage table east-ui row + the
    capability-ownership map (headless render/screenshot → e3-ui-cli).
  - `skills/east-project/SKILL.md` — `npm run shot` in the scaffolded-scripts
    docs + route to east:e3-ui-cli.
  - `skills/east-design/SKILL.md` — capability row for "screenshot/verify a
    surface from the terminal".
  - Cross-links: `e3-ui/SKILL.md` and `east-ui/SKILL.md` Related-skills gain
    a pointer.
  - **ECOSYSTEM snippet fan-out**: `docs/snippets/ECOSYSTEM.md` already lists
    @elaraai/e3-ui-cli, but every embedded copy (root README, east-ui lib
    README, sibling package READMEs — the blocks under the
    "keep in sync with docs/snippets/ECOSYSTEM.md" marker) is stale;
    re-sync them all. Add e3-ui-cli to the east-ui lib README Packages table.
- Package `CLAUDE.md` stub: orientation + pointer to
  `../east-ui/STANDARDS.md` (the shared standard — east-ui has no lib-level
  STANDARDS.md; this mirrors east-ui-components' pointer), noting TypeDoc +
  testing obligations apply to the new public surface.
- Docker: deliberately excluded — the ghcr.io/elaraai/e3 image stays
  browser-free; server users run `e3-ui install-browser` at runtime or use
  the playwright image. (Recorded so review doesn't re-ask.)

## 6. Delivery + local publish with the temporary token

Order: issue → branch (`elaraai/feat/e3-ui-cli-release-headless`) → implement
§1/2/4/5 → verify (root `pnpm install` with committed lockfile;
`make build/test/lint` in east-ui; libs/create tests; plugin `make index` +
`make build`; `make check-version`; real `e3-ui shot` smoke render with the
PNG visually inspected) → PR → **publish once** so the first npm artifact is
the robust playwright-core version.

Pre-publish guards (all must hold, else abandon the local publish and let CI
cover it):
1. `npm view @elaraai/east dist-tags.latest` is still `1.0.28` AND
   `npm view @elaraai/e3-ui-cli` is still 404 (no release train intervened —
   otherwise a `--tag latest` publish of 1.0.28 would move the dist-tag
   backwards).
2. `git log 1dbf147c..HEAD -- libs/east libs/e3
   libs/east-ui/packages/{east-ui,east-ui-components,e3-ui,e3-ui-components}`
   is empty apart from this change — the tarball's exact-pinned
   `@elaraai/{east,e3-api-server}@1.0.28` and the bundled `dist/app` must
   correspond to the published 1.0.28 sources.
3. Fresh `make build` immediately before packing (the `files` whitelist ships
   `dist/` wholesale and tsc never cleans renamed outputs — a stale
   `dist/commands/*` from the pre-refactor tree must not leak into the
   tarball; `dist/app` is safe, Vite empties it).

Then from the package dir: `pnpm publish --access public --tag latest
--no-git-checks` at `1.0.28` (version is release-managed and NOT bumped; pnpm
rewrites `workspace:*` → `1.0.28` in deps and peers). Post-publish: `npm view`
dist-tags/bin, clean-room `npm i -g` into a temp prefix, `e3-ui --version`,
`e3-ui doctor`, and a real `shot` render.

Accepted quirks (stated, not hidden): the published 1.0.28 tarball contains
changes not in the v1.0.28 release commit (superseded at the next CI release;
the already-published guard skips 1.0.28 on re-runs), and it lacks the npm
provenance attestation CI-published siblings carry (likewise superseded).

## Out of scope

- No new GitHub workflow (test-east-ui already builds/tests the package).
- No Docker image changes (decided above: e3 image stays browser-free).
- No `*.examples.ts` suite (deviation recorded in §5; static index stubs
  instead).
