# Execution-environment granularity for all runners — final reviewed design

**Status:** Final, including the owner-review pass (2026-07-08) which found and fixed one blocker (fail-open pip step → `--no-deps` + `uv pip check`, §3.1.5) — resolution record in Appendix A. All review blockers/majors resolved with re-run experiments; simplicity cuts adjudicated (Appendix A).
**Replaces:** epic elaraai/east-workspace#244 and sub-issues #239–#243 (scrapped; closing text in §8.4).
**Base:** clean `main` @ `749eadda`. **Hard precondition:** the uncommitted #239 WIP still in the working tree (manifest field, `python-source.ts`, `environment-manifest.ts`, gc/export/capture edits across 18 files + 6 untracked files) must be discarded before any implementation — every source anchor and byte-identity claim below is stated against clean HEAD.

---

## 1. Executive summary and the model

**The model, in one sentence:** a task's execution environment is captured at export as a content-addressed spec whose bytes cover the governing manifest, the governing lockfile, and the *code of exactly the local packages the environment's project transitively depends on* — so editing code in package X re-runs only the tasks whose environment closure contains X, and nothing else changes about e3's caching.

Soundness is untouched: `envHash = sha256(beast2(spec))` folds into `TaskObject.environment → taskHash → (taskHash, inputsHash)` exactly as today. There is no tracing, no manifests, no cache re-keying. Granularity comes purely from developer-chosen package boundaries. Every mechanism below fails toward **over-invalidation or a loud error, never staleness** — and the one pre-existing silent-staleness hole in main (custom-runner binaries, GAP-6) is closed by the new `tools` environment kind.

What this epic delivers:

| Runner | Today | After |
|---|---|---|
| **python (uv)** | standalone project only; workspace member → export error (GAP-1); path deps silently uncaptured → run-time failure (GAP-2) | uv workspace members, workspace roots, and standalone projects with path deps all work; per-member invalidation; **zero wire change** |
| **node (npm)** | standalone project only; workspace member → export error (GAP-3); local workspace deps unresolvable or registry-shadowed (GAP-4) | npm workspace members work with per-member invalidation via one appended wire case `workspace_node` |
| **node (pnpm)** | standalone project only | design complete and empirically validated; ships as an in-epic fast-follow (loud export error until then); single-project pnpm unchanged. NB asymmetry: standalone node `file:` path deps are N7 errors (use a workspace); standalone *python* path deps are supported |
| **C / custom runners** | binaries resolved from PATH, never hashed → **silent staleness** (GAP-6) | new `tools` environment kind: prebuilt files captured as blobs, hashed into the cache key, materialized onto PATH; rebuild → re-run (also the GAP-5 C story: embed east-c, ship the binary as a tools env) |
| **image** | digest hashed | unchanged |

### Worked example: 6 packages, 50 tasks

A pricing-and-forecasting solution as one uv workspace with six members (same shape applies to an npm workspace):

```
solution/
├── pyproject.toml            # workspace root: [tool.uv.workspace] members = ["packages/*"]
├── uv.lock                   # ONE lock for the whole workspace
└── packages/
    ├── common/               # shared utils — no tasks of its own
    ├── etl/                  # 10 tasks   environment: {python:{project:'./packages/etl'}}
    ├── pricing/              # 15 tasks   (depends on common)
    ├── forecasting/          # 15 tasks   (depends on common)
    ├── reporting/            #  8 tasks   (depends on common)
    └── optimization/         #  2 tasks   (depends on common)
```

| Change | Lock bytes | Envs whose spec changes | Tasks re-run |
|---|---|---|---|
| edit code in `forecasting` | unchanged (verified byte-identical) | forecasting only | **15** |
| edit code in `common` | unchanged | pricing, forecasting, reporting, optimization (closures contain common) | **40** |
| edit code in `etl` | unchanged | etl only | **10** |
| bump `forecasting` version | 1 lock line | all sharing the lock | 50 (accepted over-invalidation) |
| bump/add any third-party dep | lock changes | all sharing the lock | 50 (correct: shared pins) |
| edit root workspace manifest | — | all | 50 |

Rule of thumb for developers: **code edits are free-grained; version bumps and dependency changes re-run the workspace.** Without this epic the same solution is either impossible to declare (GAP-1/3) or one project where *any* edit re-runs all 50 tasks.

Boundary guidance (for §6 docs): split packages by **change cadence** (hot experimental code away from stable shared code) and put shared code in a leaf package — its edits legitimately re-run dependents. Splitting scopes *re-runs*, and for node also env *contents*; for python v1, env contents are the union of the workspace's locked third-party deps (see §3.1.6 — documented explicitly).

---

## 2. What exists today and the verified gaps

Today (verified on HEAD, `libs/e3/packages/e3/src/environment-capture.ts` [138 lines], `libs/e3/packages/e3-core/src/execution/environment.ts` [201 lines]): `environment: {python:{project}} | {node:{project}} | {image:{digest}}`; python capture requires `pyproject.toml` + `uv.lock` **in** the project dir, builds the project's own sdist; node requires a lockfile **in** the project dir, `npm pack`s the project; spec = `variant(kind, {…blob hashes…})`; materialization at `<repo>/envs/<envHash>` (python: `uv venv` + `uv sync --frozen --no-install-project` + `uv pip install <sdists>`; node: `npm ci` / `pnpm install --frozen-lockfile` + `npm install --no-save <tarballs>`); bin dir prepended to the runner's PATH; `environmentBinDir(envDir, spec): string` (single string — signature verified).

The gaps, all empirically reproduced (fixtures in the design scratchpad):

- **GAP-1 (python, export):** a uv workspace member has no own `uv.lock` — `uv lock` writes the **root** lock only (fixture `uvws`, sha256-compared) → member env decl throws at export. Multi-package uv workspaces unusable.
- **GAP-2 (python, run time):** a standalone project with `common = { path = "../common" }` exports fine but only its own sdist is captured; materialization fails far from cause: `Distribution not found at: file://…` (fixtures `uvsa`, `/tmp/e3sa`).
- **GAP-3 (node, export):** npm and pnpm workspaces keep the lock at the root only (fixtures `nodews`, `pnpmws`) → member export error, same as GAP-1.
- **GAP-4 (node, run time + wrong-code hazard):** member workspace deps aren't packed; and `npm install pricing.tgz` alone was observed issuing `GET registry.npmjs.org/@acme%2fcommon` — a same-name public package would be **silently installed** (registry shadowing). pnpm-origin tarballs fail loud (`EUNSUPPORTEDPROTOCOL workspace:*`).
- **GAP-5 (C):** custom C platform functions don't exist as a feature (east-c-cli rejects any `-p` but std). The C story is: embed east-c in your own binary and run it via `runner: {runtime:'custom'}` / `customTask` — which lands in:
- **GAP-6 (custom runners, the silent-staleness hole):** the command *string* is hashed (commandIr), the binary *bytes* are not; rebuild → same cache key → stale cached outputs keep being served.

New findings from this final review pass (fixtures re-run 2026-07-08):

- **Sibling path-dep hole (fixture `uvsib`):** with the originally-proposed closure-only skip flags, `uv sync --frozen --all-packages` fails on a clean machine when a *sibling* member has an outside path dep: `Distribution not found at: file:///tmp/uvsib-outside` — reproduced verbatim; fixed in §3.1.5.
- **`--no-install-local` (uv 0.11.21):** verified it closes the sibling hole with a *static* flag and still installs registry deps *through* skipped locals, including edge-requested extras and default dev-groups, and correctly omits non-default groups (uvws: `six, sortedcontainers, termcolor, iniconfig, wcwidth` installed; `mccabe` absent; member dirs entirely absent from disk).
- **`npm ci` is NOT a staleness oracle for workspaces (fixture `npmstale`):** adding `left-pad` to a member manifest without re-locking, then `npm ci` on the skeleton → **silently installs left-pad from the registry, unpinned** (exit 0). Export-time staleness validation is therefore mandatory for node (§3.2.4/N4).
- **Wire probes (`final-variant-probe.mjs`):** see §4.1 — the resolved case names are safe in every reader/writer direction; the previously proposed `node_workspace` name is wire-fatal (re-confirmed: old reader throws `Invalid variant tag 3` on new python bytes; new reader throws `Buffer underflow` on all existing python specs).
- **GC (HEAD `gc.ts:176–179`):** `isEnvironmentSpecShape` requires **exactly** `names.size === 3` and walks env blobs via a hand-rolled `extractChildren` branch — it does *not* call `environmentSpecObjectHashes`. Both new cases need explicit GC edits (§4.3) or their blobs get swept.

---

## 3. Design per runner

### 3.1 Python (uv) — workspaces and path deps, zero wire change

The existing `PythonEnvironmentType { pyproject, lock, sdists: [{filename, hash}] }` carries everything. `environmentSpecObjectHashes` already covers all three fields. New dependency: **`smol-toml`** (^1.7.0, BSD-3-Clause, zero deps) in `@elaraai/e3` (lock/pyproject parsing at capture) and `@elaraai/e3-core` (one materialization guard, §3.1.5) — verified it parses real `uv.lock` shapes (fixture `tomlcheck`).

#### 3.1.1 User-facing model

`environment: { python: { project: './packages/pricing' } }` now accepts a standalone uv project (unchanged), a uv-workspace member, a workspace root, or a standalone project with `tool.uv.sources` path deps. Requirements: the project's `pyproject.toml` has `[project].name` and a `[build-system]`, and the governing lockfile exists.

#### 3.1.2 Root discovery — lock-first (replaces the uv-mirroring walk)

The full uv discovery mirror (`pyproject.toml` ancestor walk + a hand-built Rust-glob matcher + members/exclude semantics) is **cut** (all four reviewers converged; the lock backstop was always the real gate). The rule, in `environment-capture.ts`:

1. `<project>/uv.lock` exists → root = project. (Standalone today; workspace roots; excluded members with own locks.)
2. Else walk parent dirs to the nearest dir `R` containing `uv.lock` → candidate root.
3. **Membership gate (formerly the "E6b backstop", now the primary mechanism):** parse the lock; the project is a member iff some `[[package]]` entry has a local source (`editable`/`directory`/`virtual`) that resolves (`path.resolve(R, src)`, realpath + case-normalized on win32) to the project dir. That entry's (PEP 503-normalized) `name` is the **subject**. No match → error **P4**.
4. No lock found anywhere → error **P3**.

This deletes `uvGlobMatch`, the pyproject workspace-table parsing, and the 6-case discovery test matrix. Any uv-side discovery subtlety (globs, excludes, nearest-pyproject stops) is uv's problem at `uv lock` time; e3 trusts only what the lock records, loudly.

#### 3.1.3 Identity (what is hashed)

- `spec.pyproject` = blob of the **root** `pyproject.toml` (for standalone that's the project's own — today's bytes, unchanged).
- `spec.lock` = blob of the **root** `uv.lock`.
- `spec.sdists` = the closure's sdists (§3.1.4), sorted by filename.
- Member pyproject bytes ride inside the member's sdist → member manifest edits invalidate via the sdist hash. Shared-lock semantics verified: member **code** edits leave the root lock byte-identical (sibling envs unaffected); a member **version bump** changes exactly one lock line (all lock-sharers re-run, accepted); third-party bumps re-run all (correct).

#### 3.1.4 Closure walk (uv.lock v1)

Guard: `lock.version === 1` else **P5** (unknown `revision` tolerated). Per `[[package]]`: `name`, `version`, `source` ∈ `{registry} | {editable} | {directory} | {virtual} | {git} | {url} | {path: archive}`; edges in `dependencies`, `optional-dependencies` (extras), `dev-dependencies` (PEP 735 groups — the lock lists all groups). `[manifest].members` present only in workspace locks (verified). Default groups: root `[tool.uv].default-groups` (absent → `['dev']`; `'all'` → all; list → list).

```
walk from subject; per visited name n (re-visit when new extras arrive):
  entries = lock.package[name == n]          // >1 possible for marker-forked registry pkgs
  none → P4 (n == subject) / P6 (dangling edge)
  no entry has a local source → SKIP         // registry/git/url deps are sync's job at materialization
  else (unique local entry e):
    e.source.path (archive) → P9
    include n → e
    edges = e.dependencies
          + defaultGroups' entries of e['dev-dependencies']  IF n ∈ manifest.members
            // sync activates default groups of WORKSPACE MEMBERS only (verified)
          + e['optional-dependencies'][x] for each extra x requested on edges INTO n
            // own extras NOT followed; edge-requested extras ARE (both verified)
    markers on edges IGNORED (universal over-capture; documented corner in §5)
    enqueue edge.name; accumulate edge.extra into requested-extras[edge.name]
```

This walk is the irreducible core of the epic (explicitly endorsed by review — capture-whole-workspace would forfeit the granularity win) and its extras/groups precision is what guarantees the pip step never resolves unpinned from PyPI for closure code.

**Sdist building:** per included package, sorted-name order: `dir = path.resolve(root, source.editable ?? source.directory ?? source.virtual)`; `virtual` → **P7** (not packaged); missing dir → **P8**; run `uv build --sdist --out-dir <fresh mkdtemp>` with `cwd = dir` (uniformly handles members, outside-workspace path deps, and standalone — all verified; `--all-packages` rejected: silently skips unbuildable members, builds non-closure siblings). Sanity: sdist filename's PEP 625 name must equal `n` else **P10**. `uv build` writes nothing into the source dir (verified).

#### 3.1.5 Materialization — one static command (`e3-core` `buildPython`, ~25-line delta)

One unified sequence for old and new specs, workspace and standalone (no spec discrimination):

```
write pyproject.toml (spec.pyproject) and uv.lock (spec.lock)        # unchanged
GUARD (old-broken-spec): parse uv.lock; if it has NO [manifest] section AND some package
  has a non-root local source (directory / editable≠"." / path) with no matching captured
  sdist (PEP 625 name from spec.sdists filenames) → loud error:
  "environment was captured without its local path-dependency code (captured by an older
   @elaraai/e3) — re-export the package with @elaraai/e3 >= <R2>"
uv venv --relocatable .venv                                          # unchanged
uv sync --frozen --all-packages --no-install-workspace --no-install-local
uv pip install --python .venv --no-deps <all sdist files>            # single invocation, order-free
uv pip check --python .venv                                          # loud satisfiability gate (fail-closed)
```

- `--frozen`: member directories need not exist (verified — no stubs).
- `--all-packages --no-install-workspace`: union of all members' locked registry deps + default groups; skips every member incl. the root (superset of today's `--no-install-project`; verified the virtual scaffold root's own deps ARE installed — the runner-on-PATH story holds).
- **`--no-install-local`** replaces the previously-designed per-sdist `--no-install-package` flags **and** fixes the reviewer-proven sibling hole (fixture `uvsib`: designer command fails `Distribution not found at: file:///tmp/uvsib-outside` on a clean machine; static command succeeds; `import subject` OK). Registry deps still flow through skipped locals, including edge extras and default dev-groups (verified §2). No name derivation, no per-spec flags.
- **The pip step is fail-closed by construction (owner-review blocker fix):** `--no-deps` means the sdist install can never resolve anything from a registry, and `uv pip check` then verifies satisfiability loudly. This matters because a resolution-ON pip step was **demonstrated live** to silently install PyPI's real `common==0.1.2` when a local sdist was absent — reachable for old workspace-root specs (whose workspace lock exempts them from the P11 guard) and for any future closure-walk bug. With `--no-deps` + `check`, every such case is a loud `The package '<x>' requires '<y>', but it's not installed` instead of silent wrong code, for **all** spec vintages. (Verified: hazard reproduced, fix green on the full sequence — Appendix A.)
- The **P11 guard** is thereby demoted from load-bearing to UX: it turns the generic pip-check failure into a specific, actionable message for old GAP-2-broken specs. Workspace locks (`[manifest]` present) skip the guard — sibling locals are legitimately sdist-less, and the pip-check gate covers them regardless.
- Sync **before** the pip step is load-bearing (sync prunes to its plan — verified it uninstalled a pre-installed sdist); comment it.
- Old working standalone specs: identical outcome (superset flags are no-ops — verified).

**Windows:** the lock stores forward-slash relative paths (portable); `path.resolve` accepts them; compare paths case-insensitively on win32; absolute path deps work on the exporting machine and are skipped by `--no-install-local` at materialization; `uv` is a real .exe; `.venv/Scripts` handling unchanged. Minimum uv: a version providing `--no-install-local` and `uv pip check` (verified 0.11.21; docs state the floor; older uv fails loudly with an unknown-flag error).

#### 3.1.6 Documented behavior positions

- **Env contents are union-scoped in v1:** every member env installs the whole workspace's locked third-party set (`--all-packages`). Splitting packages scopes *re-runs*, not env size. A torch-heavy sibling bloats every env's build time/disk but never affects invalidation. Stated verbatim in scaffold README + docs. The `--package`-scoped alternative (needs a wire field) is **rejected for v1**, recorded in the decision record — revisit only if union bloat hurts in practice.
- **"We capture what you locked":** no lock-freshness check beyond the membership gate (no `uv lock --check`, which can hit the network). A stale-but-consistent lock materializes exactly what was locked — same semantics as today's standalone envs; drift surfaces as loud import errors. (Contrast node, §3.2.4, where the package manager is provably *not* a loud oracle.)
- Default dependency-groups (dev) of members remain installed (matches sync's default; leaner runtime envs rejected as a behavior change).

#### 3.1.7 Error catalogue (single source of truth; all at export unless noted)

- **P1** `pyproject.toml` missing in project — existing message.
- **P2** no `[project].name`: "Environment for '<owner>': '<project>/pyproject.toml' has no [project].name — an environment project must be a named package".
- **P3** no `uv.lock` in the project or any ancestor: "…run 'uv lock' in '<project>' (standalone), or if it should be a uv workspace member, add it to [tool.uv.workspace].members of the workspace root and run 'uv lock' there".
- **P4** nearest lock doesn't list the project: "uv.lock at '<R>' does not list a package at '<project>' — the lockfile is out of date or the project is not a workspace member; run 'uv lock' at '<R>' (or 'uv lock' in '<project>' if it is standalone)".
- **P5** `uv.lock` version ≠ 1: "unsupported uv.lock version <v> — update @elaraai/e3 (or re-lock with a compatible uv)".
- **P6** dangling lock edge: "uv.lock is internally inconsistent ('<from>' depends on unknown '<to>') — re-run 'uv lock'".
- **P7** closure package not packaged (virtual / no build-system, incl. the subject): "package '<n>' at '<dir>' is not packaged (no [build-system]) — every package captured into an execution environment must build as an sdist; add e.g. [build-system] requires=[\"hatchling\"] build-backend=\"hatchling.build\"".
- **P8** local source dir missing: "package '<n>' resolves to '<abs>' (uv.lock source '<raw>') which does not exist — re-run 'uv lock', or fix the [tool.uv.sources] path".
- **P9** `path = <archive>` source: "local archive dependency '<n>' is not supported in execution environments — use a directory/workspace source or publish to a registry".
- **P10** built sdist name mismatch — internal sanity.
- **P11** *(materialization, e3-core)* the old-broken-spec guard of §3.1.5.

### 3.2 Node — npm workspaces now, pnpm workspaces as in-epic fast-follow

**Mechanism (both package managers): workspace skeleton reconstruction.** Capture stores the root manifest + root lock verbatim plus an `npm pack` tarball per closure member; materialization reconstructs a minimal workspace containing *only* the closure members and runs the frozen install against the full root lock. Both npm and pnpm tolerate a workspace with fewer members than the lock records (verified) — closure pruning for free; non-closure members' third-party deps are never installed (left-pad pruning verified). Rejected alternatives (all hands-on evaluated): `pnpm deploy` (non-deterministic, absolute paths baked into shims, install-output-not-capture); bare tarball installs without a lock (third-party floats + the confirmed registry-shadow hazard); lock pruning/synthesis (re-implements arborist/pnpm).

**Scope decision:** v1 implements **npm workspaces** (the scaffold's zero-prerequisite default). A pnpm workspace root at capture → loud export error **N8** until the pnpm issue (I13) lands. The pnpm design (§3.2.6) is complete and empirically validated; the wire already carries its `config` field, so it lands with **zero additional wire change**. Single-project pnpm envs are unchanged throughout.

#### 3.2.1 Wire: one appended variant case `workspace_node`

The originally proposed name `node_workspace` is **wire-fatal** — re-verified this pass (§4.1). Final shape (naming per §4; `NullableType` does not exist in East — `OptionType` verified):

```ts
export const WorkspaceNodeEnvironmentType = StructType({
  /** Object hash of the workspace ROOT package.json blob, verbatim. */
  packageJson: StringType,
  /** Object hash of the ROOT lockfile blob, verbatim (content-sniffed as today). */
  lock: StringType,
  /** pnpm only (none for npm): capture-synthesized pnpm-workspace.yaml blob hash. */
  config: OptionType(StringType),
  /** Workspace-relative POSIX path of the environment's own member. MUST satisfy
   *  members.some(m => m.path === subject) — enforced at capture and re-validated
   *  in buildWorkspaceNode (BEAST2 decode is structural only; it cannot validate). */
  subject: StringType,
  /** Dependency closure, sorted by path; name from the member's package.json at
   *  capture; tarball = object hash of its `npm pack` output. */
  members: ArrayType(StructType({ path: StringType, name: StringType, tarball: StringType })),
});
```

Why a wire case instead of the zero-wire extension-field convention: old-reader failure must be **loud**. Verified: the legacy `buildNode` on workspace-shaped inputs is a *silent no-op* (`npm ci` "up to date", nothing installed) followed by a tarball step that would silently install a shadowed registry package for npm-origin members. The appended case makes every pre-epic reader throw `Invalid variant tag` instead (probe-verified). The zero-wire fallback is **deleted** from the design (this paragraph is its rejection record). There is **no degraded whole-workspace mode** (`subject: '.'` removed): declaring the workspace *root* as the project is export error **N3** — the invariant stays clean and the remedy for root-depends-on-member is "restructure", not "go coarse".

#### 3.2.2 Capture — mode detection

Declaration unchanged: `environment: { node: { project: './packages/pricing' } }`.

1. Project contains its own lockfile (`package-lock.json` | `npm-shrinkwrap.json` | `pnpm-lock.yaml`) → single-project capture, today's byte-identical path.
2. Else walk parents to the first dir `R` with one of those lockfiles; none → **N1**.
3. npm lock at `R`: `rel = posixRelative(R, project)` must be a key of `lock.packages` (with `lock.packages[""].workspaces` present) → workspace mode, `subject = rel`. pnpm lock at `R` → **N8** (v1). Non-member → **N2**.
4. `project === R` (workspace root) → **N3**.

#### 3.2.3 Closure walk — npm (`package-lock.json`, lockfileVersion ≥2)

Reference implementation verified against the fixture (pricing → {pricing, common}; forecasting → {forecasting}):

- BFS from `subject`. For visited member path `P`: `name = lock.packages[P].name ?? basename(P)`; deps = union of `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies` (over-inclusion fails toward over-capture, never a broken install).
- Resolve each dep name by **nearest-ancestor lookup**: `${P}/node_modules/${N}`, then each parent's `node_modules/${N}`, ending at root (nested entries occur on hoist conflicts — verified). Missing entry → skip (npm ci's call, e.g. unmet optional).
- Entry `link: true` → local member: target = `entry.resolved`; outside root / absolute → **N7**; else enqueue.
- Entry without `link` → registry/git/url: stays in the lock, installed by `npm ci`, never captured.

**Export-time validation (all loud, before anything is stored):**

- **N4 — lock staleness (mandatory, evidence-backed):** for each closure member, the on-disk manifest's dep sections must match `lock.packages[path]`'s. This pass **proved `npm ci` silently installs unlocked member deps from the registry** (fixture `npmstale`: manifest-added `left-pad` installed, unpinned, exit 0) — the frozen install is *not* a loud oracle for npm workspaces, so without this check a stale lock at capture silently materializes unpinned registry code. (Reviewer 4's cut of this check is rejected on this evidence; see Appendix A.)
- **N5 — registry-shadow, hard ERROR (upgraded from WARN per review):** a closure member's dep whose *name* equals any workspace member but resolves to a non-`link` lock entry → error: "'<dep>' in '<member>' is satisfied from the registry, not the workspace — align the version range to the workspace version (or rename the member). If you intentionally depend on the published package, restructure so the names differ." npm has no `workspace:` protocol; this drift is its classic wrong-code footgun (registry GET confirmed). No opt-out flag in v1; add one only on demonstrated need.
- **N6 — root manifest depends on a workspace member** → error; remedy: "move member deps out of the root manifest into the members that need them".
- **N7** local dep resolves outside the workspace / absolute → error. `file:` protocol deps in the closure → error ("not capturable; use a workspace member").
- **N9** packed tarball's embedded name ≠ expected member name — internal sanity.

**Artifact production:** per closure member, `npm pack --pack-destination <tmp>` with `cwd` = member dir. npm pack is byte-deterministic across runs and mtime touches (sha256-verified) and preserves specifiers verbatim (no rewrite step; also why npm pack is used for pnpm later — `pnpm pack` rewrites `workspace:*` and then fails the frozen install, verified). `prepack` runs at capture — the sanctioned build hook, same contract as publishing. Spec: `variant('workspace_node', { packageJson, lock, config: none, subject, members sortedByPath })`. All member envs of one workspace share the manifest/lock blobs (content-addressed dedupe); only tarball sets differ.

#### 3.2.4 Materialization — `buildWorkspaceNode` (e3-core; new dep `tar-stream`)

Same temp-sibling + atomic-rename protocol; legacy builders untouched:

1. Write `lock` blob (v1: must sniff as npm — defensive error otherwise). Write `packageJson` with `"workspaces"` set to the sorted member paths (explicit, no globs; npm ci doesn't cross-check the field against the lock — verified).
2. Extract each member tarball to `<buildDir>/<member.path>` with `tar-stream` + `node:zlib`: strip leading `package/`, **reject** `..`, absolute paths, and symlink/hardlink entry types; mode floor 0o644/0o755. Verify extracted `package.json` name === `member.name` (loud).
3. `npm ci --no-audit --no-fund --ignore-scripts`. Verified end-to-end: installs root deps + closure members' third-party (incl. nested-conflict versions), auto-links members at `node_modules/<name>`, hoists member bins to root `.bin`, never contacts the registry for `link: true` members (whole `@acme` scope 404s publicly, install succeeds), prunes absent members' deps.
4. **win32 link-retarget pass:** walk `buildDir` for directory links whose absolute target lies under `buildDir` and re-point to the equivalent path under the final `envDir` (npm/pnpm create absolute junctions on Windows; after the atomic rename they'd dangle). This plausibly also fixes a **latent main bug** for today's single-project pnpm envs on Windows (CI covers only the npm scaffold — verified by reading `environment-e2e.spec.ts`). A Windows CI probe is a hard precondition of this issue (I5).
5. Post-build sanity assert (guards the observed silent-no-op class): every `<path>/package.json` exists AND `node_modules/<name>` resolves; else "materialized workspace is incomplete".
6. `environmentBinDir` changes signature `string → string[]` (HEAD returns a single string — verified; internal-only, call sites via `materializeEnvironment` unchanged). npm: `[<envDir>/node_modules/.bin]`. The warm-path early return is updated identically.

**Runner resolution (no changes to processExec / east-node-cli):** east-node resolves `-p <name>` via `createRequire(dirname(argv[1]))` first; argv[1] = a shim in the returned bin dir. Verified from materialized envs: `require('@acme/pricing')`, `require.resolve('@acme/pricing/platform')` (exports-map subpath), locked third-party at exact versions.

**Scripts stance:** installs keep `--ignore-scripts`; member code arrives by tar extraction → **no lifecycle scripts at materialization**; members must be require-ready at pack time (`prepack` builds `dist/` — publishing's contract). The legacy single-project path's with-scripts behavior is intentionally unchanged (changing behavior under existing env hashes is staleness-adjacent).

**Invalidation:** edit member code → only its tarball hash changes → only envs whose closure contains it re-run. Third-party bump anywhere → root lock blob changes → all workspace envs re-run. Member version bump → tarball + lock change (over-invalidates on npm — accepted). Code edits never touch the lock. Unlike python, node env *contents* are member-scoped (closure-only skeleton) — the asymmetry is documented.

#### 3.2.5 pnpm workspaces (design complete; ships as I13)

Validated mechanics, unchanged from the reviewed design plus reviewer 1's peer-dep fix: `yaml@^2` in `@elaraai/e3`; closure walk over `lock.importers` (v9; older → export error) following `dependencies`/`devDependencies`/`optionalDependencies` **+ `peerDependencies`** `link:` targets (a `workspace:*` peer must pull the sibling's tarball or autoInstallPeers could registry-shadow it); member names read from disk at capture (the pnpm lock carries none — hence the wire `members.name`); capture-synthesized `pnpm-workspace.yaml` blob (`packages:` = sorted closure paths + settings copied verbatim from the lock's `settings:` — `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` verified both necessary and sufficient) stored in `config` (e3-core stays YAML-free); `npm pack` for tarballs (specifier-verbatim); materialization: write config, `pnpm install --frozen-lockfile --ignore-scripts` (accepts the partial workspace, +closure-third-party only, never hits the registry for members), then explicit root `node_modules/<name>` member links (relative symlink POSIX / junction-to-final-envDir win32) — these make by-name + subpath resolution work from the runner's require root (verified); `environmentBinDir` = `[<envDir>/<subject>/node_modules/.bin, <envDir>/node_modules/.bin]`. v1-of-I13 export errors: `catalog:` specifiers, `settings.patchedDependencies`, `dependenciesMeta.*.injected`. Floors: pnpm ≥9 lock at capture, pnpm ≥10 at materialization.

#### 3.2.6 Node error catalogue

**N1** no lockfile in project or ancestors (existing message + workspace mention). **N2** not a member of the workspace at `<R>`: "…add it to \"workspaces\" of '<R>/package.json' and refresh the lockfile — or, if this project is standalone, run 'npm install' in '<project>' to create its own lockfile" (both remedies, per review). **N3** project is a workspace root: "declare the environment on a workspace member, not the root". **N4** stale lock (§3.2.4). **N5** registry-shadow hard error. **N6** root→member dep. **N7** outside-root / absolute / `file:` local dep. **N8** pnpm workspace root: "pnpm workspaces are not yet supported as environments — use npm workspaces or a single-project env (pnpm workspace support tracked in <I13>)". **N9** tarball name mismatch (internal).

### 3.3 `tools` — prebuilt files for C and custom runners (closes GAP-6; the GAP-5 story)

e3 never builds anything: the developer builds with make/CMake/cargo however they like; e3 captures the named outputs as content-addressed blobs, folds their bytes into the env hash, and materializes them onto PATH. Rebuild → new blob hash → new envHash → that env's tasks re-run. **The C story (GAP-5):** embed east-c as a library in your own binary, run it via `runner: { runtime: 'custom', command: ['my-runner', …] }` or `customTask`, and attach `environment: { tools: { files: ['./build/my-runner'] } }`.

**SDK declaration + definition-time validation (browser-safe, filesystem-free):**

```ts
export type EnvironmentDecl =
  | { python: { project: string } }
  | { node:   { project: string } }
  | { image:  { digest: string } }
  | { tools:  { files: [string, ...string[]] } };   // ≥1 file, paths relative to export CWD
```

**T1** empty `files` → "tools.files must name at least one file". **T2** entry ends with `/`or`\` → "looks like a directory — list files individually". **T3** duplicate basenames (case-insensitive — one flat env bin dir; win32/macOS FS) → error naming both. No globs, no directories in v1 (the wire `path` supports subdirs, so sugar can come later without a wire change).

**Capture** (same `addBlob` plumbing as sdists; memoized per distinct decl per export via the existing `JSON.stringify(decl)` map, `export.ts:57–70` verified — 50 tasks sharing one decl read the files once): per file, `p = path.resolve(f)`; `statSync(p)` (follows symlinks — captures target bytes); missing → **T4** "tools file '<f>' not found at '<p>' — build it before export (e3 does not build your binaries)"; not a regular file → **T5**. Entry = `{ path: 'bin/' + basename(p), hash: addBlob(bytes) }`, sorted by path (decl order must not affect envHash). **No `mode` field** (cut applied — see §4.1 and Appendix A): exec-bit-only chmods don't change the hash, and since materialization always applies the same mode, the materialized env is genuinely unchanged — no staleness.

**Wire:**

```ts
export const ToolsEnvironmentType = StructType({
  files: ArrayType(StructType({
    path: StringType,   // env-dir-relative POSIX path; v1 writers emit 'bin/<basename>'
    hash: StringType,   // object-store blob hash of the file bytes
  })),
});
```

**Materialization** (`buildTools`, e3-core): per file, validate `path` (reject absolute, `..`, empty segments), write blob to `<buildDir>/<path>`, `chmod 0o755` on POSIX (nothing on win32 — no exec bits; the blanket rule closes the Windows open question). `environmentBinDir` → `[<envDir>/bin]`. Cheapest builder in the file; no subprocesses.

**Windows:** developers list `my-runner.exe`; the existing `shell: win32` spawn pattern resolves PATHEXT (positions verified against HEAD).

**Developer loop honesty (docs):** edit `main.c` without `make` → no capture change → no re-run (correct: the deployed binary didn't change). `make` without re-export → old binary served until the next export; under `e3 watch`, rebuilt binaries are picked up at the next watch-triggered export **only if the build outputs are inside watched paths** — I8's acceptance criteria include verifying and documenting watch coverage ("add `build/` to watch paths or run `e3 package export` after `make`").

### 3.4 image — unchanged

`{ image: { digest } }` stays byte-identical: full immutable digest required at definition time, no blobs, `environmentSpecObjectHashes → []`. Its spec *bytes* shift once with the type-table change like every other kind (§4.2).

---

## 4. Wire deltas, rollout, e3-cloud checklist

**Backward-compatibility stance (owner decision, 2026-07-08): none — lockstep upgrade.** e3 and e3-cloud upgrade together; we do **not** support an old reader decoding new-SDK bytes, and we do **not** carry a legacy decoder for old bytes. This removes the readers-first two-phase gate and all old-reader compatibility machinery. The two things that survive are *not* backward compatibility — they prevent a live repo from corrupting **its own** already-persisted objects across a single deploy: the frozen case **order** (§4.1) and the robust GC predicate (§4.3). Existing repos that already declared an `environment` must be **re-exported** after upgrade (the one-time hash shift, §4.2, re-runs those tasks once anyway).

### 4.1 The one schema change (both cases together)

BEAST2 variant tags are positional indexes into the **alphabetically sorted** case list (`libs/east/src/types.ts:346–348`; decoder dispatch `beast2/index.ts:349–360` — both re-verified). New cases are appended so the sorted order only grows at the end: `image, node, python, tools, workspace_node`. This is required not for old-reader compat but so a **repo's own** persisted specs keep decoding across future edits — reordering the cases re-tags every later case and mis-decodes stored specs. Verified this pass (`final-variant-probe.mjs`): a 5-case reader round-trips every case and decodes existing python/node/image bytes unchanged (tags 0–2 unmoved); the rejected `node_workspace` name would have re-tagged `python`, mis-decoding every stored python spec — the rename to `workspace_node` (sorts last) avoids that.

`e3-types/src/environment.ts`: add `ToolsEnvironmentType` (§3.3) + `WorkspaceNodeEnvironmentType` (§3.2.1); `EnvironmentSpecType = VariantType({ python, node, image, tools, workspace_node })`;

```ts
case 'tools':          return spec.value.files.map((f) => f.hash);
case 'workspace_node': return [spec.value.packageJson, spec.value.lock,
                               ...(spec.value.config.type === 'some' ? [spec.value.config.value] : []),
                               ...spec.value.members.map((m) => m.tarball)];
```

**One frozen-order guard test** (`e3-types/src/environment.spec.ts`): asserts the sorted case order is exactly `['image','node','python','tools','workspace_node']` with a comment stating the rule — a new case must extend the order only at the end (or readers must first migrate to name-based, self-describing decoding). Turns an accidental reorder into a red test. Plus round-trip tests for the two new cases (incl. a `workspace_node` with a pnpm `config` blob + multiple members).

### 4.2 The one-time envHash shift

`encodeBeast2For` embeds the full root type table, so the moment the 5-case type ships, freshly-encoded specs of **all** kinds change bytes even when content is identical (probe: python spec hash `d23c8965 → ad3f8dba`). Consequence: **the first export with the upgraded SDK re-keys every environment once → all env-bearing tasks re-run once.** Over-invalidation (the safe direction), exactly once (both cases land in one e3-types change), led in release notes. This one event also subsumes the "re-export existing environments after upgrade" migration step — there is nothing extra to do.

### 4.3 GC and reachability (blocker fix — verified against HEAD)

`gc.ts` does **not** use `environmentSpecObjectHashes`: `isEnvironmentSpecShape` requires exactly `names.size === 3` (HEAD `gc.ts:176–179`) and a hand-rolled `extractChildren` branch walks python/node inline (line 332ff). Without edits, new-kind env blobs classify as leaves → unreachable → **swept; object-not-found at materialization** (data loss, loud only after the damage). Required edits, in the same PR as the wire change:

- Predicate: `names ⊇ {python,node,image} && names ⊆ {python,node,image,tools,workspace_node}`. This is robustness, not back-compat: a repo may hold not-yet-re-exported specs (encoded before this change, 3-case type descriptor) when GC runs, and GC must never sweep their live blobs. The self-describing GC decode path reads each blob's own embedded type table, so a 3-case descriptor must still be recognized as an environment.
- `extractChildren`: `tools` → each `files[].hash` (leaf); `workspace_node` → `packageJson`, `lock`, `config` when some, each `members[].tarball` (all leaves).
- `gc.spec.ts`: new-kind blobs (tools, workspace_node incl. config) survive collection.
- Mirror both edits in **e3-cloud's** GC analogue.

### 4.4 Release train (lockstep)

No readers-first gate (no backward-compat requirement). The wire + GC + materializer changes ship as one coordinated upgrade of e3 **and** e3-cloud:

- **e3-types + e3-core (this PR, #272/#273 grouped):** both wire cases, the frozen-order guard + round-trip tests, GC predicate + `extractChildren`, `environmentBinDir` over all 5 kinds, and a loud "not yet supported by the local runner" for `tools`/`workspace_node` until their materializers land (#274 tools, #276 workspace_node). The tree builds and all existing envs behave identically.
- **Materializers + capture + DX (following issues):** `buildTools`, `buildWorkspaceNode`, unified `buildPython`, then the SDK capture paths and scaffold/docs.
- **e3-cloud (lockstep):** upgrade `@elaraai/e3-types`; audit every `decodeBeast2For(EnvironmentSpecType)` site; worker materializers gain the new kinds; cloud GC predicate + `extractChildren` (§4.3); reachability walkers via `environmentSpecObjectHashes` (audit for hand-rolled copies). Ship with (or before) the e3 side — not after.

**Migration note (cookbook):** upgrade e3 and e3-cloud together; do not run a mixed-version fleet or import R2-SDK bundles into a not-yet-upgraded installation (a stale reader/GC has no legacy decoder and would fail loud or, for GC, could sweep new-kind blobs — recoverable by re-import; retain bundle zips). Existing environment declarations are re-exported as part of the normal one-time re-run (§4.2).

---

## 5. Determinism position

- **Hatchling** (scaffold default) and **uv_build** sdists are byte-reproducible across mtime changes (both sha256-verified) → re-export without changes keeps env hashes stable. Setuptools-backend sdists embed mtimes → worst case **over-invalidation**, documented; no manifests, no normalization (per the #244 review record).
- **npm pack** is byte-deterministic across runs and mtime touches in both npm and pnpm workspaces (verified; fixed-epoch mtimes). Cross-toolchain-version pack/build drift (npm or uv major upgrades) → worst case a one-time over-invalidation; accepted and documented.
- Spec bytes are deterministic by construction: sorted sdists/members/files; verbatim manifest/lock blobs; deterministic config synthesis (sorted keys) for pnpm later.
- **Documented residual (python marker corner):** a *non-member* local dep reachable only via platform-marker-gated edges is captured (markers ignored) while marker-aware sync may skip its registry deps on platforms where the marker is false — with the fail-closed pip step this now surfaces as a **loud `uv pip check` failure** on such platforms (previously: unpinned resolution). Rare, and impossible for workspace members (`--all-packages` roots them all — verified with the `uvmark` fixture). The lock-faithfulness guarantee is scoped to workspace members + marker-free-reachable path deps. (`--no-deps` does not affect build-backend acquisition — sdist builds still fetch their backends normally; `--offline` remains wrong for the pip step.)
- The one-time type-table hash shift is §4.2's, not a determinism defect.

---

## 6. DX

### 6.1 Scaffold (`libs/create`: `packages/scaffold-core/src/{cli.ts,scaffold.ts}`, `templates/e3/template.json`)

New flag: `npm create @elaraai/e3 my-app -- --packages pricing,forecasting` (python members; template.json gains a `packages` feature alongside `tests`/`ui`/`platform`):

- Root `pyproject.toml` becomes a uv workspace (`[tool.uv.workspace] members = ["packages/*"]`); root keeps dev tooling (pytest, east-py-cli) as root-only deps — **verified** the virtual root's own deps install under the unified sync (runner-on-PATH holds on dev machines and clean workers).
- Per member: `packages/<name>/{pyproject.toml (hatchling build-system), src/<name>/__init__.py}` + an example platform function.
- `src/environments.ts`: `export const pricingEnv = { python: { project: './packages/pricing' } } as const;` etc.; example tasks wired with `environment: pricingEnv`. Sharing the exported const gives export-time memoization for free (`JSON.stringify` keyed — verified).
- README (honest): *"Editing `packages/pricing/**` re-runs exactly the tasks declaring `pricingEnv`. Version bumps and dependency changes re-run the whole workspace. Per-package environments scope re-runs, not env contents: each python env installs the workspace's full locked third-party set."* Node platform code keeps the tsc-build-before-export caveat; **no** wording implying watch-mode auto-capture.
- Node workspaces ship **docs-only** in v1 (cookbook recipe below — the integration test scripts exactly the conversion); a node leg for `--packages` is a named follow-up, not in this epic.

### 6.2 SDK sugar: none

`e3.environment()` is **not added** (ratified by review). A shared exported object literal already gives identity, reuse, and memoization; a wrapper would add API surface with zero semantics.

### 6.3 Error messages

Single source of truth: python **P1–P11** (§3.1.7), node **N1–N9** (§3.2.6), tools **T1–T5** (§3.3). Every export error names the file/package at fault and one or two concrete remedies. The earlier standalone DX catalogue is deleted; its E5 (which forbade the supported-and-verified outside-workspace path dep) and E4 (which promised a python freshness check the design declines) are gone.

### 6.4 The one observability line

When `e3 workspace deploy` (incl. inside `watch`) replaces a task whose hash changed, print **one line per changed task** naming which top-level TaskObject component differs — `environment` / `command` / `inputs` — computed from the two TaskObjects already in hand. Special case (first upgrade UX): if environment *bytes* differ but the decoded specs deep-equal → `environment re-encoded by SDK upgrade (no content change) — one-time re-run`. No new subcommand, no spec-internal diffing, no history; the `(path, hash)` lists make deeper diffing trivially addable later if users ask.

### 6.5 Migration cookbook (docs page, shipped in R2)

1. **Existing single-project users:** no decl changes. On first export with the upgraded SDK, every environment re-hashes once and its tasks re-run once (§4.2) — expected, one-time. Upgrade e3 (and e3-cloud workers) **before** importing bundles produced by upgraded SDKs; keep bundle zips as recovery (§4.4).
2. **Split a python project into a uv workspace:** create `packages/`, move code, add `[tool.uv.workspace]` to the root pyproject, give each member a `[project].name` + `[build-system]`, run `uv lock` at the root, point each task's `environment` at its member. First export re-runs everything once; thereafter edits are member-scoped.
3. **Convert node platform code to an npm workspace:** root `package.json` gains `"workspaces": ["packages/*"]`; move code into members; `npm install` at the root (root lock); `environment: { node: { project: './packages/x' } }`. Keep member deps out of the root manifest (N6); keep member version ranges matching workspace versions (N5 — note in release notes: a member name that collides with a registry package you *intend* to use is a hard error in v1; rename or restructure). Standalone node `file:` path deps remain unsupported (N7) — use a workspace; python path deps ARE supported (asymmetry documented in the model table).
4. **Custom-runner users (C):** build your binary as usual; add `environment: { tools: { files: ['./build/my-runner'] } }` to the task/customTask. Rebuild → next export re-runs that env's tasks — this *closes* a hole where rebuilds were silently ignored; expect re-runs you didn't get before. Ensure build outputs are in watched paths or re-export after `make`.
5. **When to split packages:** by change cadence; shared code in leaf packages; python envs are union-sized (v1), node envs closure-sized.

### 6.6 Docs outline

One restructured page "Execution environments": the granularity model (§1 table) → kinds (python / node / tools / image) → per-runner how-to → invalidation semantics table → error reference (P/N/T) → migration cookbook → determinism notes.

---

## 7. Test plan and acceptance criteria

**Unit — e3-types:** frozen case-order guard test; cross-version encode/decode fixtures pinning the §4.1 probe matrix; `environmentSpecObjectHashes` for all five kinds.

**Unit — e3 (capture):** python: lock-first discovery matrix (own lock; ancestor lock member; non-member → P4; no lock → P3; project-is-root), closure walks on checked-in lock fixtures (plain deps; edge-extra expansion; default vs non-default groups; directory path dep; virtual → P7; stale/absent membership → P4; dangling edge → P6; version guard → P5; archive → P9), sdist name round-trip (underscore names). node: mode detection matrix; npm closure walk (nested node_modules conflict entry, devDep/peerDep link, outside-root → N7); export checks N4 (stale member manifest), N5 (shadow), N6 (root→member), N8 (pnpm root); **spec-level granularity assert lands here** (export twice: sibling code edit → subject spec bytes byte-identical; shared-dep edit → both members' specs change). tools: T1–T5; decl-order-independent spec bytes; symlinked input captures target bytes.

**Unit — e3-core (materialization):** unified buildPython command assembly + P11 guard (old-broken standalone fixture errors; workspace lock with sibling sdist-less locals passes); buildWorkspaceNode skeleton e2e from fixture lock + tarballs (require by name + subpath, bins on PATH, left-pad pruned, sanity assert fires on synthetic silent no-op); tar sanitization rejects `../`, absolute, link entries; buildTools (path sanitization, 0o755, bin dir); GC: new-kind blobs survive, old 3-case bytes classify; warm-path reuse.

**Integration (existing e2e chassis, `libs/e3/test/integration/src/environment-e2e.spec.ts`; CI ubuntu/macos-14/windows):**
(a) uv workspace: scaffold `--packages` → export → delete source → import/deploy/run in a fresh repo; task imports member + local dep + registry dep. (b) uv standalone + outside path dep, same flow (GAP-2). (c) **clean-worker sibling fixture** (`uvsib` shape): subject env materializes on a machine without the sibling's path-dep dir. (d) npm workspace: convert scaffold to 3 members → member env → same flow. (e) tools env with a custom runner. (f) mixed-runner package (python member + node member + tools in one package). (g) **repo-side bundle round-trip:** `workspaceExport` of a workspace holding `tools` + `workspace_node` envs → import into a fresh repo → materialize (proves the export walkers carry the new-kind blobs, not just SDK-export bundles).

**Acceptance criteria (the epic is done when all pass):**

1. **Sibling no-cross-invalidation (python + node):** edit sibling member code → re-export → subject env spec **byte-identical**, its tasks *not* re-run (spec-level in capture PRs; e2e in the matrix).
2. **Shared-dep propagation:** edit `common` → both dependents' env hashes change, their tasks re-run.
3. **GAP-6 regression (tools):** run task → rebuild binary with changed bytes → re-export → task **re-runs**; without rebuild, no re-run.
4. Third-party bump → all lock-sharing envs re-run.
5. Existing-spec handling (lockstep, no legacy decode): after upgrade, pre-epic python/node specs re-export once (§4.2) and materialize behavior-identically; GAP-2-broken old specs fail loud (P11 message); old workspace-root specs (root sdist only, member deps unresolvable) fail loud at `uv pip check` — **the pip step never resolves a local name from a registry** (regression test: the `common`-shadow scenario must error, not install).
6. Wire round-trips: every case (incl. `tools`, `workspace_node` with/without `config`) encode/decode-equals; the frozen case-order guard test pins `['image','node','python','tools','workspace_node']`.
7. N4/N5 fire at export on stale-lock and shadowed-member fixtures (npm never gets to install unpinned registry code — the `npmstale` scenario is impossible post-export).
8. GC never sweeps blobs of any env kind reachable from a live package (incl. a not-yet-re-exported 3-case spec).
9. Windows leg: junction retarget verified by the CI probe; `uv`/npm flows green on windows-latest.

---

## 8. Effort and the new epic

Total: **17–22.5 engineer-days** core (waves 1–3) + **2.5–3.5d** pnpm fast-follow. (Includes the e3-cloud line item review demanded.)

### 8.1 Issue breakdown

**E0 — Epic: developer-chosen environment granularity for all runners**
Body: the §1 summary + model table + link to this document; design values (simple/boring/loud); the R1/R2 release train; acceptance = §7 criteria. Precondition checklist item: discard the #239 WIP working-tree changes and delete branch `elaraai/feat/e3-fine-grained-change-detection-244`.

| # | Title (release) | Body / acceptance criteria | Effort |
|---|---|---|---|
| I1 | e3-types: append `tools` + `workspace_node` env spec cases (R1) | Types per §3.2.1/§3.3/§4.1; `environmentSpecObjectHashes`; frozen case-order guard test `['image','node','python','tools','workspace_node']` with the sort-last rule comment; cross-version probe fixtures. AC: §4.1 matrix green as tests; both cases must land in this one change. | 0.5–1d |
| I2 | e3-core: GC reachability for new env kinds (R1) | Widen `isEnvironmentSpecShape` predicate (⊇3 ∧ ⊆5); `extractChildren` branches per §4.3; gc.spec coverage old+new bytes. AC: §7 criterion 8. | 0.5d |
| I3 | e3-core: `buildTools` materializer (R1) | §3.3 materialization; path sanitization; 0o755; `environmentBinDir → string[]` refactor rides here. AC: tools env materializes, binary executes from PATH. | 0.5–1d |
| I4 | e3-core: unified `buildPython` (R1) | Static command `uv sync --frozen --all-packages --no-install-workspace --no-install-local` + `uv pip install --no-deps <sdists>` + `uv pip check` (fail-closed pip step, §3.1.5); P11 guard (smol-toml, UX fast-path); sync-before-pip comment. AC: uvws/uvsa/uvsib-shaped fixtures materialize in clean dirs; old-broken spec → loud P11; old workspace-root spec → loud pip-check failure, **never a registry install of a local name** (the `common`-shadow regression test); old working specs unchanged. | 0.5–1d |
| I5 | e3-core: `buildWorkspaceNode` (npm skeleton) + Windows probe (R1) | §3.2.4 steps 1–6 (tar-stream dep); win32 junction-retarget pass; `subject ∈ members` invariant validated here (decode is structural only); **precondition:** a windows-latest CI probe materializing a single-project pnpm env + an npm workspace skeleton, to ground the retarget pass in observed junction behavior (may expose/repair the latent single-project pnpm-on-Windows bug). AC: skeleton e2e unit tests; sanity assert; subject-invariant rejection test; probe results recorded. | 2–2.5d |
| I6 | e3-cloud lockstep (R1; separate repo) | §4.4 checklist: decode sites, worker materializers (tools, workspace_node, unified python), cloud GC predicate+branches, walkers, ops runbook "workers before writers". AC: cloud e2e of each new kind; R0-bundle-import note in runbook. | 2–3d |
| I7 | e3: python workspace + path-dep capture (R2) | §3.1.2–3.1.4 + P1–P10; smol-toml dep; **spec-level granularity assert in this PR** (§7-1). AC: GAP-1/GAP-2 fixtures export; uvsib closure correct; discovery matrix green. | 2.5–3d |
| I8 | e3: `tools` decl + capture (R2) | §3.3 decl/validation/capture; T1–T5; GAP-6 regression test (§7-3); verify + document `e3 watch` coverage of tools file paths. | 1–1.5d |
| I9 | e3: node npm-workspace capture (R2) | §3.2.2–3.2.3 + N1–N9 (N4 staleness + N5 hard shadow error); pack loop; spec-level granularity assert in this PR. AC: nodews fixture closures {pricing→pricing,common / forecasting→forecasting}; `npmstale` scenario → N4 at export. | 2.5–3d |
| I10 | Integration matrix on the e2e chassis (R2) | §7 integration (a)–(f), 3 OS. AC: §7 criteria 1–5, 9. | 1.5–2d |
| I11 | DX: scaffold `--packages` + docs + migration cookbook (R2) | §6.1, §6.5, §6.6; release notes leading with the one-time re-run (§4.2). | 1.5–2d |
| I12 | Observability: deploy re-run reason line (R2) | §6.4 incl. the re-encoded-no-content-change special case; one line per changed task, nothing else. | 0.5d |
| I13 | pnpm workspaces (fast-follow, in-epic) | §3.2.5 (yaml dep, importer walk **+ peerDependencies**, config synthesis, member links, exclusions, floors) + pnpm integration twin; removes N8. Precondition: I5's Windows probe results. | 2.5–3.5d |

### 8.2 PR order

I1+I2 (one PR: wire+GC) → I3, I4, I5 (parallel) → **release R1** + I6 deployed → I7, I8, I9 (parallel; each carries its spec-level granularity/regression asserts) → I10, I11, I12 → **release R2** → I13.

### 8.3 Dependency additions (owner sign-off, §10-Q1)

`smol-toml` ^1.7.0 (BSD-3, zero-dep) → `@elaraai/e3`, `@elaraai/e3-core`; `tar-stream` → `@elaraai/e3-core` (already used in the workspace by east-node-io/east-node-cli; new to the e3 lib); `yaml` ^2 → `@elaraai/e3` (I13 only).

### 8.4 Closing text for the scrapped issues

- **#244 (epic, syscall tracing):** "Closing: direction scrapped per the design review and alternatives exploration (2026-07-07). Tracing/manifest-based fine-grained invalidation was judged high-risk/high-complexity relative to its win. Superseded by <E0>: invalidation granularity = developer-chosen package boundaries per execution environment, with today's whole-environment hash unchanged. The review record lives with this issue; the replacement design document is attached to <E0>."
- **#239 (structured environment / manifest phase 0):** "Closing as not planned: the manifest/normalization wire direction is explicitly rejected in the replacement design (<E0>, non-goals). The uncommitted WIP for this issue is discarded and branch `elaraai/feat/e3-fine-grained-change-detection-244` deleted; plain main is the base for <E0>."
- **#240–#243 (tracing sub-issues):** "Closing as not planned: parent epic #244 was scrapped in favor of the simpler package-boundary granularity design — see <E0> for the replacement scope covering the same user problem (edit code in package X → only X's tasks re-run)."

---

## 9. Non-goals

Per the #244 review record (linked from the epic) and this review round: **no** syscall tracing, **no** environment manifests, **no** archive normalization, **no** selective/partial environment loading, **no** structural identity re-keying of the cache. Additionally decided here: no `e3.environment()` SDK sugar; no name-based self-describing spec decoding this epic (guard test + sort-last rule instead, with name-based decode documented as the escape hatch when a future case can't sort last); no `E3_ENV_DIR` env var or data-only tools composition; no tools globs/directories; no capture of `git`/`url` python sources (sync installs them from locked revs at materialization — same network position as registry deps); no `path=<archive>` capture (P9); no `--package`-scoped python sync or wire `package` field (union materialization accepted; revisit on demonstrated bloat pain); no degraded whole-workspace node mode; no zero-wire node extension-field mechanism; no node-workspace scaffold template in v1 (cookbook recipe instead); no npm-lock pruning/synthesis; no changes to runner resolution (`processExec`, `E3_RUNNER_SEARCH_DIRS`, east-node-cli) or the `EnvironmentDecl` API shape beyond the added `tools` key.

---

## 10. Open questions for the owner

1. **Dependency sign-off** (repo policy): `smol-toml` in `@elaraai/e3` + `@elaraai/e3-core`, `tar-stream` in `@elaraai/e3-core`, and (I13 only) `yaml` in `@elaraai/e3`.
2. **Ratify the one-time envHash shift** (§4.2): first export after upgrading re-runs every env-bearing task once (and re-exports any existing environment declarations, since there is no legacy decoder). Forced by the variant addition; release-note wording drafted in §6.5-1.
3. **e3-cloud lockstep** (§4.4): confirm e3 and e3-cloud upgrade together — no mixed-version fleet, no readers-first window (backward compatibility is explicitly out of scope). The coordination lives in the e3-cloud repo the owner controls.
4. **pnpm timing:** I13 is scoped in-epic as the final issue (recommended — the design is validated and the wire already carries `config`); confirm, or move it to the backlog knowing pnpm workspace users hit N8 until it lands.

---

## Appendix A — Review resolution record

**Blockers/majors** (all resolved; fixture commands re-run this pass where reviewers and designers disagreed):

| Finding | Resolution | Evidence |
|---|---|---|
| `node_workspace` case name wire-fatal (3 reviewers) | Renamed `workspace_node`; both cases in ONE e3-types change; single 5-case guard test | `combined-variant-probe.mjs` re-run (fatal confirmed); `final-variant-probe.mjs` (full matrix green) |
| GC sweeps new-kind env blobs (designer claim "goes through the helper" false) | §4.3 predicate widen + branches + tests + cloud mirror, same PR as wire | HEAD `gc.ts:176–179` `names.size === 3` + hand-rolled branch at 332ff, read this pass |
| Python sibling outside-path-dep hole (export-ok/materialize-fail) | Static `--no-install-local` flag (simpler than both the designer's per-sdist flags and reviewer 1's whole-lock parse) + P11 guard for old-broken specs | `uvsib` failure reproduced verbatim; fix verified (`import subject` OK on clean dir); registry-through-skipped-locals preserved on `uvws` (mccabe correctly absent) |
| Byte-identity contradiction across components | One position (§4.2): one-time shift at R1, release-noted; contradictory claims deleted | probe: `d23c8965 → ad3f8dba` |
| Release sequencing unassigned for buildPython | Unified buildPython pinned to R1 (§4.4) | — |
| `NullableType` doesn't exist / `environmentBinDir` signature / `subject` invariant | `OptionType`; `string → string[]` in I3; subject must be a member path (no `'.'`) | grep + HEAD `environment.ts:39` |
| DX catalogue contradictions; DX incompleteness (cookbook/example/effort) | Single catalogues in §3 (DX E4/E5 deleted); cookbook §6.5, worked example §1, DX effort I11 | — |
| Granularity test sequencing | Spec-level asserts ride the capture PRs (I7/I9), not the integration issue | — |
| Node e3-cloud effort missing | I6 line item 2–3d | — |
| Python union bloat vs persona; node/python asymmetry | Documented loudly (§3.1.6, §6.1); scoped-sync rejected for v1 | — |

**Cuts adjudicated** (design values: simple > clever; applied unless a stated requirement breaks):

- **ACCEPT** cut uv discovery mirror (`uvGlobMatch` + pyproject walk): the lock membership gate is the real mechanism; ~100 LOC of foreign-glob mirroring deleted (§3.1.2).
- **ACCEPT (rephased)** pnpm out of the first wave: the brief *requires* the pnpm design, so it stays fully specced (§3.2.5) and in-epic as I13 behind loud N8 — the risky 40% is isolated without shrinking committed scope.
- **ACCEPT** drop `--package`-scoped sync + wire `package` field; **ACCEPT** keep P9 archive error (no capture); **ACCEPT** delete zero-wire node fallback (one rejection sentence retained, §3.2.1); **ACCEPT** drop degraded whole-workspace mode (N3 instead); **ACCEPT** one log line only for "why did this re-run" (+ re-encode special case); **ACCEPT** drop tools `mode` field (blanket 0o755; no staleness possible since materialization mode is spec-independent; re-add cost = known dual-decode dance, accepted); **ACCEPT** one e3-types release for both cases; **ACCEPT** `tools` name ratified, alternatives deleted; **ACCEPT** single guard test authored once against the final 5-case set; **ACCEPT** cut name-based decode from this epic (rename made it unnecessary; guard test documents the migration path); **ACCEPT** no `artifact`-train references (name disproven); **ACCEPT** discard #239 WIP (verified still in tree — made an explicit epic precondition); **ACCEPT** DX catalogue merge; **ACCEPT** park node scaffold-default paragraph (docs-only node workspaces in v1); **ACCEPT** scaffold README honesty (no watch-auto-capture claims); **ACCEPT** E3_ENV_DIR / data-composition stay out.
- **REJECT** cut of node export-time lock-staleness validation (reviewer 4) — new evidence this pass: `npm ci` **silently installs** a stale member manifest's unlocked deps from the registry (fixture `npmstale`, left-pad unpinned, exit 0), so the frozen install is not a loud oracle and dropping N4 would open a silent lock-unfaithful path; the ~20-line dep-map comparison stays, and the unified philosophy is stated honestly: *capture what you locked; fail at export where materialization would otherwise be silently wrong (npm) — python needs no such check because uv `--frozen` is faithful to the lock by construction.*
- **REJECT** (implicitly proposed by cut-everything pressure) capturing whole workspaces instead of closures — explicitly endorsed as the irreducible core by review; kept as specced.

**Do-not-cut confirmations:** per-ecosystem closure walks (the epic's entire win); uv walk extras/groups precision (what keeps the pip step pinned); tools non-goals held.

**Owner-review pass (2026-07-08, senior model), resolutions applied above:**

| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| Resolution-ON pip step is fail-open: with a local sdist absent, `uv pip install <sdist>` silently installed PyPI's real `common==0.1.2` and `import common` served wrong code. Reachable for old workspace-root specs (P11's `[manifest]` exemption) and any closure-walk bug | **Blocker** | Pip step → `uv pip install --no-deps` + `uv pip check` (§3.1.5); P11 demoted to UX; "covered by construction" claim deleted; regression test in I4/§7-5 | Hazard reproduced live (matz fixture, `common==0.1.2` installed + imported); fix verified fail-closed (`requires common, but it's not installed`, exit 1) and green on the full sequence (`All installed packages are compatible`) |
| §3.2.1 claimed `subject` "validated at decode" — BEAST2 typed decode is structural only | Major | Enforced at capture + re-validated in `buildWorkspaceNode`; I5 AC extended | `decodeBeast2For` read (beast2/index.ts:766–804): no validation hook |
| §8.3 "tar-stream already used by `@elaraai/e3`" false on clean HEAD (stale-WIP contamination) | Minor | Corrected to workspace-level usage (east-node-io/cli) | `git show HEAD:libs/e3/packages/e3/package.json` — 0 hits |
| Test plan lacked a repo-side `workspaceExport` round-trip for new-kind blobs | Minor | §7 integration (g) added | walkers verified on HEAD to flow through `environmentSpecObjectHashes` |
| N5 hard-error consequence + node/python path-dep asymmetry under-surfaced | Minor | §1 table NB + §6.5-3 release-note wording | — |
| Wire mechanics independently re-derived from source (variant sort, tag indices, embedded type table, expected-type decode): §4.1/§4.2 confirmed correct | — (verification) | none needed | types.ts:346–348, beast2/index.ts:349–360, 690–810 read; unified materialization re-run end-to-end in a bare dir (IMPORT-OK) |