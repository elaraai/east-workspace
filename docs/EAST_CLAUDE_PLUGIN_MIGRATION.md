# East Claude Code Plugin — Migration Plan

## Context

`~/src/east-plugin` is a standalone repo holding the **Claude Code plugin** for the East ecosystem (skills, hooks, an MCP search server, project-scaffolding scripts, machine-wide install scripts, runtime Docker images). It predates the monorepo: when each lib lived in its own GitHub repo, east-plugin was the umbrella that stitched them together — its `update-skills.yml` clones all five source repos to assemble skills + a search index.

Now that `east`, `east-node`, `east-py`, `east-ui`, `e3` all live in `east-workspace`, that cross-repo assembly is obsolete, and several artifacts buried in the plugin are actually **shared ecosystem infrastructure** consumed outside Claude Code:

- The runtime images `ghcr.io/elaraai/{e3,east-node}` are built+pushed by `docker.yml` and used by **cloud infra outside this repo**.
- `docker/install-packages.sh` installs the **entire** ecosystem (east + east-node + east-ui + e3 via npm; east-py-* via uv) and is shared by both Dockerfiles and the local install scripts.
- The project-scaffolding and global-install scripts onboard users regardless of Claude Code.

This migrates the plugin into `libs/east-claude-plugin/` **and** extracts the shared infra to top-level homes.

## Principles

1. Plugin keeps only Claude-Code-specific things (skills, hooks, MCP, index generator, manifest).
2. Shared infra moves out: Docker → top-level `docker/`; install/scaffold scripts → top-level `scripts/`.
3. Kill the cross-repo clone — skills + search index assemble from sibling libs in-tree.
4. One canonical copy of each SKILL.md (lives in its lib; plugin syncs, never hand-maintains a drifted dup — today `skills/e3/SKILL.md` already differs from `libs/e3/SKILL.md` by one line).
5. Naming: plan docs `SCREAMING_SNAKE_CASE.md`; topical lowercase-kebab; `SKILL.md` load-bearing.

## Rename

`east-plugin` → **`east-claude-plugin`** at `libs/east-claude-plugin/`. Disambiguates from the VS Code extension (`libs/east-ui/packages/east-ui-extension`).

## Runtime-safety analysis (what survives the move untouched vs what breaks)

**Migration-safe (plugin-root-relative, no edit needed):**
- `hooks/hooks.json` — every hook is `node "${CLAUDE_PLUGIN_ROOT}/.build/hooks/*.js"`. `${CLAUDE_PLUGIN_ROOT}` is set by Claude Code to the plugin dir.
- `.mcp.json` — `node "${CLAUDE_PLUGIN_ROOT}/.build/mcp/search-server.js"`.
- `lib/lazy-search.ts:8` — `INDEX_PATH = join(__dirname, "..", "..", "index.json")`; bundled into `.build/hooks/`, resolves to plugin-root `index.json`.
- `mcp/search-server.ts:10` — identical `INDEX_PATH`; bundled into `.build/mcp/`.
- `scripts/generate-index.ts:411` — `projectRoot = import.meta.dirname/../..` → plugin root; reads `index.config.json`/`index.static.json`, writes `index.json` there.

  **Implication:** as long as the plugin's internal layout (`.build/`, `index.json`, `index.static.json`, `index.config.json`, `skills/`) is preserved when moved, the hooks + MCP + index load keep working. `${CLAUDE_PLUGIN_ROOT}` makes the move transparent.

**`.build/` is committed, not generated-on-install.** `.gitignore` ignores `build/` and `dist/` but **not** `.build/`. The marketplace install loads `.build/hooks/*.js` directly, so the committed bundle is what runs. This conflicts with the monorepo convention of gitignoring build output — **the plugin must keep `.build/` committed** (note it as an exception, or add a publish step).

**What actually breaks and needs edits** — everything below.

## Target structure

```
east-workspace/
├── .claude-plugin/
│   └── marketplace.json          # MOVED to root; plugin source: ./libs/east-claude-plugin
├── docker/                       # NEW
│   ├── images/                   # → ghcr.io
│   │   ├── Dockerfile.e3
│   │   ├── Dockerfile.east-node
│   │   ├── install-packages.sh
│   │   └── docker-compose.yml    # builds/runs the images
│   ├── services/
│   │   └── docker-compose.yml    # MOVED from repo root (test backends)
│   └── tests/
│       ├── test-install.sh
│       └── test-docker-builds.sh
├── scripts/                      # NEW
│   ├── install.sh
│   ├── install-dev.sh            # REWRITTEN (monorepo, not 6 clones)
│   ├── update.sh
│   ├── update-dev.sh             # REWRITTEN
│   ├── lib/common.sh
│   └── scaffold/{e3.sh,east.sh}
├── docs/conventions/SKILLS_STANDARD.md   # MOVED
├── libs/
│   ├── east/SKILL.md                     # canonical (symlink target)
│   ├── e3/SKILL.md                       # canonical
│   ├── east-ui/packages/east-ui/SKILL.md # canonical
│   ├── east-node/packages/east-node-*/SKILL.md
│   ├── east-py/packages/east-py-datascience/SKILL.md
│   └── east-claude-plugin/      # slimmed plugin
│       ├── .claude-plugin/plugin.json
│       ├── .build/{hooks,mcp}/*.js   # committed bundle (no install build)
│       ├── skills/*/SKILL.md         # SYMLINKS → ../../../<lib>/SKILL.md
│       ├── hooks/*.ts + hooks.json
│       ├── mcp/search-server.ts
│       ├── lib/*.ts
│       ├── scripts/generate-index.ts
│       ├── index.{json,config.json,static.json}
│       ├── docs/*.md
│       ├── tests/*.sh
│       └── package.json
└── docker-compose.yml            # DELETED (→ docker/services/)
```

## File-by-file change manifest

### 1. Move the plugin → `libs/east-claude-plugin/`

`git mv` the whole repo content minus the extracted `docker/` and `scripts/{global,project,lib}` (those go top-level, below). Then:

- **`package.json`**: `"name": "@elaraai/east-plugin"` → `"@elaraai/east-claude-plugin"`. `bundle` / `generate-index` scripts unchanged (paths are plugin-relative).
- **`pnpm-workspace.yaml`** (monorepo root): glob `- "libs/east-plugin"` → `- "libs/east-claude-plugin"`; fix the comment `# east-plugin — VS Code extension` → `# east-claude-plugin — Claude Code plugin`.
- **Marketplace placement (resolved):** the **monorepo root becomes the marketplace**. Move `marketplace.json` to `east-workspace/.claude-plugin/marketplace.json`, with the plugin entry `"source": "./libs/east-claude-plugin"` (relative-path source — supported). The plugin's own manifest stays at `libs/east-claude-plugin/.claude-plugin/plugin.json`. This is what makes the skill symlinks (§2) count as "within the same marketplace", and lets `/plugin marketplace add <east-workspace>` resolve the subdir plugin.
- **`.claude-plugin/plugin.json`**: keep the user-facing plugin name `east` (that's `/plugin install east`).
- **`.build/` + `index.json` — committed, but treated as generated (not "code"):** plugins are copied to cache as-is with **no install-time build**, and the runtime paths are plugin-root-relative, so the bundled hooks/MCP JS + `index.json` must live in the plugin dir. They can't move to the root `.claude-plugin/` (that's outside the plugin root → not copied to cache). Keep them in-tree but out of code review/tooling:
  - **`.gitignore`**: keep `.build/` and `index.json` tracked (do not ignore). `dist/` (tsc output) stays ignored.
  - **`.gitattributes`** (monorepo root or plugin dir):
    ```
    libs/east-claude-plugin/.build/**   linguist-generated=true -diff
    libs/east-claude-plugin/index.json  linguist-generated=true -diff
    ```
    Collapses them in PR diffs, drops them from language stats.
  - **Tooling excludes**: plugin `tsconfig.json` `exclude` + eslint ignore + test globs skip `.build/` and `index.json` so `make build/lint/test` never treats them as source.
  - **CI generates + commits**: the `bundle` (esbuild → `.build/`) and `generate-index` (→ `index.json`) run in CI on relevant changes and commit the result, so they're never hand-stale.
  - Alternative (rejected): symlink `.build`/`index.json` from the plugin root to real files under root `.claude-plugin/` — works (marketplace-internal symlinks are dereferenced into the cache) but pollutes the marketplace-manifest dir with one plugin's bundle and adds indirection for no real gain.

### 2. Skills → committed **symlinks** (the documented meta-plugin pattern)

The plugins-reference confirms: marketplace plugins are copied to `~/.claude/plugins/cache`; symlinks pointing **elsewhere within the same marketplace** are *dereferenced* (target content copied into the cache). So with the **monorepo root as the marketplace**, the plugin's `skills/<name>/SKILL.md` can be a relative symlink to the canonical lib file — no copy step, no drift, no CI sync, no committed duplicate content.

Replace each `skills/<name>/SKILL.md` with a relative symlink (depth: `skills/<name>/` → repo root is `../../../..`; libs is `../../..`):
| symlink | target |
|---|---|
| `skills/east/SKILL.md` | `../../../east/SKILL.md` |
| `skills/e3/SKILL.md` | `../../../e3/SKILL.md` |
| `skills/east-ui/SKILL.md` | `../../../east-ui/packages/east-ui/SKILL.md` |
| `skills/e3-ui/SKILL.md` | `../../../east-ui/packages/e3-ui/SKILL.md` (NEW — Decision #1/B) |
| `skills/east-node-std/SKILL.md` | `../../../east-node/packages/east-node-std/SKILL.md` |
| `skills/east-node-io/SKILL.md` | `../../../east-node/packages/east-node-io/SKILL.md` |
| `skills/east-py-datascience/SKILL.md` | `../../../east-py/packages/east-py-datascience/SKILL.md` |

(Plugin at `libs/east-claude-plugin/`, so from `skills/<name>/` three `../` reaches `libs/`, then into the lib.) On install the symlinks dereference and the real content lands in the cache. The 1-line e3 drift disappears by construction — there is only one file. Verify on a Windows checkout (`git config core.symlinks true`); if Windows support matters, fall back to a `sync-skills` copy + CI drift-check.

**Requires the marketplace root to be the monorepo root** (see §1 marketplace placement) so the symlink targets count as "within the same marketplace".

### 3. Search index → retarget + add new source

- **`index.config.json`**: with `--base-dir` pointed at the monorepo `libs/` (see make target), the `testDir` values mostly hold; **two changes**:
  - `east-ui` source: `"testDir": "east-ui"` → `"east-ui/packages/east-ui"` (today it scans the whole east-ui tree and sweeps in `e3-ui` + would silently absorb future `e3-ui-components`/`east-ui-components`/`*-showcase` examples, mis-tagged as `east-ui`).
  - **Add** a source for `libs/east-ui/packages/e3-ui` (3 `.examples.ts` files: `data`, `ontology`, `diff`) tagged `skill: "e3-ui"` (Decision #1/B): `{ "package": "e3-ui", "skill": "e3-ui", "testDir": "east-ui/packages/e3-ui", "pattern": "**/*.examples.ts" }`.
- **`generate-index` invocation**: today CI passes `--base-dir .sources`. New: a `make generate-index` target passing `--base-dir <abs path to libs/>`. No code change in `generate-index.ts` (projectRoot + static merge are plugin-root-relative).
- **`index.static.json`**: unchanged — this is where e3's examples come from (e3 has **zero** `.examples.ts`). Optional follow-up: give e3 real example files + an `e3` source, retire static.
- **Audit at migration time**: `find libs -name '*.examples.ts'` currently → east(19), east-node-io(14), east-node-std(8), east-py-datascience(28), east-ui(100), **e3-ui(3, new)**. Re-run before locking config; new packages land often.

### 4. Docker → `docker/{images,services,tests}/`

- **Move**: `docker/Dockerfile.e3`, `Dockerfile.east-node`, `install-packages.sh`, `docker-compose.yml` → `docker/images/`. `test-install.sh` → `docker/tests/`. `tests/test-docker-builds.sh` → `docker/tests/`.
- **Move** monorepo root `docker-compose.yml` → `docker/services/docker-compose.yml`; delete root copy.
- **Edit Dockerfile COPY paths** (build context = repo root):
  - `docker/images/Dockerfile.east-node:38`: `COPY docker/install-packages.sh` → `COPY docker/images/install-packages.sh`.
  - `docker/images/Dockerfile.e3:92`: same edit. (`:98` `COPY --from=east-c-build …` is from a build stage — no change.)
  - Update the `org.opencontainers.image.source` labels (`:33` in each) `…/east-plugin` → `…/east-workspace`.
- **`docker/images/docker-compose.yml`**: `context: .` is relative to the compose file; with files now in `docker/images/`, set `context: ../..` (repo root) so `COPY docker/images/…` resolves; `dockerfile:` stays relative to context → `docker/images/Dockerfile.*`.
- **`docker/tests/test-docker-builds.sh`** (lines 16, 21): `-f docker/Dockerfile.east-node` / `-f docker/Dockerfile.e3` → `-f docker/images/Dockerfile.*`; `REPO_ROOT` computed via `../..` now needs `../..` from `docker/tests/` = repo root (verify the relative `cd`).
- **Root `Makefile`** `services-up`/`services-down`/`services-status`: add `-f docker/services/docker-compose.yml` to the `docker compose` calls. (Workflows that call `make services-up`, e.g. `test-e3.yml`, are covered transitively.)

### 5. Scripts → top-level `scripts/`

- **Move** `scripts/global/{install,update}.sh`, `scripts/lib/common.sh` → top-level `scripts/`. `scripts/project/{e3,east}.sh` → `scripts/scaffold/`.
- **Relative-source fix**: `install.sh:24-25`, `update.sh`, `install-dev.sh`, `update-dev.sh` all `source "$SCRIPT_DIR/../lib/common.sh"`. Flattening `global/` → `scripts/` makes `../lib` wrong → change to `"$SCRIPT_DIR/lib/common.sh"`. (`common.sh` itself moves to `scripts/lib/common.sh`, so scaffolders in `scripts/scaffold/` referencing it would use `$SCRIPT_DIR/../lib/common.sh` — they currently inline their own colors, so check.)
- **`install-dev.sh` — REWRITE** (currently 320 lines cloning 6 repos + per-repo `make install/build/test/link`, lines 50-51 `REPOS=(...)`, 235-293): collapse to clone `east-workspace` once → `make install && make build && make link`. Drop the per-repo dependency-ordered build (pnpm does it). `update-dev.sh` similarly → `git pull && make build && make link`.
- **`install.sh` precise edits**:
  - `:3` curl URL `…/east-plugin/main/scripts/global/install.sh` → `…/east-workspace/main/scripts/install.sh`.
  - `:233` `e3 init` → **`e3 repo create .`** (the `init` alias was dropped in the CLI refactor — `e3 init` no longer exists).
  - `:234` `e3 start` → `e3 dataflow run` (note: needs a workspace; the quick-start snippet should be corrected to a real sequence or trimmed).
  - `:236` doc URL `…/east-plugin` → `…/east-workspace`.
- **`scaffold/e3.sh` precise edits** (generated project Makefile):
  - `:380-381` `e3 package import .repos /tmp/pkg.zip` + `e3 workspace deploy .repos $WS $PKG@1.0.0` → `e3 workspace deploy .repos $WS --from-zip /tmp/pkg.zip` (or keep import+deploy but it's two steps; `--from-zip` is the new one-shot).
  - `:382` `e3 start .repos $WS` → `e3 dataflow run .repos $WS`.
  - `:385` `e3 watch .repos $WS ./src/index.ts --start` → `e3 watch ./src/index.ts .repos $WS --start` (source-first arg order).
  - `:4` curl URL → east-workspace path.
- **`scaffold/east.sh`**: curl URL only (`:4`); no e3 commands (verified clean).
- **README / docs**: every `raw.githubusercontent.com/elaraai/east-plugin/main/scripts/{global,project}/…` URL → `…/east-workspace/main/scripts/{,scaffold/}…`.

### 6. CI workflows → monorepo `.github/workflows/`

- **`docker.yml`** → `docker-publish.yml`:
  - `:44` `./tests/test-all.sh --quick` → `bash docker/tests/test-docker-builds.sh` (the plugin test runner shouldn't gate image publish).
  - `:124` `file: ./docker/Dockerfile.east-node` → `./docker/images/Dockerfile.east-node`.
  - `:244` `file: ./docker/Dockerfile.e3` → `./docker/images/Dockerfile.e3`.
  - `paths: docker/**` stays. `context: .` stays. The npm-version queries (`:64-96`, `:155-216`) are unchanged (images install **published** packages, not local source).
  - Reconcile the `tags: ['v*']` trigger with the monorepo's release tagging — Decision #5.
- **`update-skills.yml`** → **delete**, replace with a light `plugin-artifacts.yml`: run `npm run bundle` + `npm run generate-index` (in `libs/east-claude-plugin`, base-dir = `libs/`) and fail if `git diff` on `.build/` or `index.json` is non-empty (artifacts committed-and-current). Skills need no check — they're symlinks (one source file). Trigger on `libs/**/SKILL.md`, `**/*.examples.ts`, and the plugin's `hooks/`/`lib/`/`mcp/`. No repo cloning.
- **`bump-version.yml`**: `:26` `repositories: east-plugin` → `east-workspace`; `:42` test path; `:89` push URL `…/east-plugin.git` → `…/east-workspace.git`. Or fold into the monorepo's existing version/publish flow. Decision #5.

### 7. Docs / conventions

- **Move** `docs/SKILLS_STANDARD.md` → `docs/conventions/SKILLS_STANDARD.md` (monorepo-wide; SCREAMING_SNAKE correct).
- Plugin design docs (`hooks-design.md`, `hooks-context-injection.md`, `scripts-design.md`) → `libs/east-claude-plugin/docs/` (topical lowercase-kebab; OK as-is).
- **`CLAUDE.md`** (root): repo-layout section currently groups the plugin under east-ui's description and mislabels it; add `east-claude-plugin`, `docker/`, `scripts/` as their own entries; fix the "VS Code extension" wording.
- `libs/e3/SKILL.md`: already updated for the new command tree (done in the e3 DX work) — plugin copy syncs from it.

## Decisions

1. **e3-ui skill (RESOLVED): Option B — create a dedicated `e3-ui` skill.** `e3-ui` is the "e3 + UI bridge" (Data bindings, `ui()` task, manifest). Deliverables:
   - **Author `libs/east-ui/packages/e3-ui/SKILL.md`** (frontmatter `name: e3-ui`, description covering Data bindings / `e3.ui()` task / manifest), conforming to `docs/conventions/SKILLS_STANDARD.md`. Source the content from the package's API + its three example files (`data`, `ontology`, `diff`).
   - **7th skill symlink**: `libs/east-claude-plugin/skills/e3-ui/SKILL.md` → `../../../east-ui/packages/e3-ui/SKILL.md`.
   - **Index source** (§3): `{ package: "e3-ui", skill: "e3-ui", testDir: "east-ui/packages/e3-ui", pattern: "**/*.examples.ts" }`.
   - **Register everywhere the skills are listed** (now 7): root `CLAUDE.md` "Plugin skills" block, `libs/east-claude-plugin/README.md` skill table, and the marketplace skill listing.
   - This makes it **7 skills**, not 6, throughout the plan.
2. **Skills (RESOLVED): committed symlinks.** Per the plugins-reference meta-plugin pattern (symlinks within the marketplace are dereferenced into the cache). No copy/sync. Caveat: Windows symlink support — fall back to copy + CI drift-check only if needed.
3. **Marketplace subdir (RESOLVED): yes.** Root `.claude-plugin/marketplace.json` with `"source": "./libs/east-claude-plugin"`. Relative-path sources are supported; the plugin is copied to cache on install. Still worth a **smoke test** (`claude plugin marketplace add <local east-workspace>` → `claude plugin install east`) before decommissioning the old repo.
4. **`.build/` committed (RESOLVED): required.** No install-time build; the cache copy must contain runnable JS. Keep `.build/` + `index.json` tracked, regenerated in CI and committed. (The "ideally not" isn't achievable without breaking load; CI-generation keeps them from going hand-stale.)
5. **Release/versioning** — reconcile the plugin's `v*` tag + `bump-version` with the monorepo release flow. (Confirmed: yes, reconcile.)

## Migration steps (each keeps the tree green)

1. **Docker**: create `docker/{images,services,tests}/`, move files, edit the 2 Dockerfile COPY lines + labels, the image compose `context`, `test-docker-builds.sh` paths, root `Makefile` services targets; delete root `docker-compose.yml`. Verify `make services-up` + `bash docker/tests/test-docker-builds.sh`.
2. **Scripts**: create top-level `scripts/` (+`lib/`, `scaffold/`), move + fix `../lib` → `lib` sources, rewrite `install-dev.sh`/`update-dev.sh` for the monorepo, fix curl URLs + the `e3 init`/`e3 start`/`e3 watch` command updates in `install.sh` + `scaffold/e3.sh`.
3. **Plugin move**: `git mv` remainder → `libs/east-claude-plugin/`; rename package; fix `pnpm-workspace.yaml`; move `marketplace.json` → root `.claude-plugin/` with `source: ./libs/east-claude-plugin`; keep `.build/` + `index.json` tracked.
4. **Skills (symlinks) + index**: author `e3-ui/SKILL.md`; replace the seven `skills/<name>/SKILL.md` with relative symlinks to the lib files (incl. new `e3-ui`); add a `generate-index` make target; edit `index.config.json` (pin east-ui to `packages/east-ui`, add `e3-ui` source); regenerate `index.json`; verify MCP `search_east_examples` + the prompt-submit hook return hits.
5. **Workflows**: port `docker-publish.yml` (repathed), replace `update-skills.yml` with `skills-check.yml`, repath `bump-version.yml`.
6. **Docs**: move `SKILLS_STANDARD.md` → `docs/conventions/`; update root `CLAUDE.md` layout.
7. **Decommission** `~/src/east-plugin` once verified + marketplace source repointed (Decision #3).

## Verification

- `make build` / `make lint` / `make test` green after each step.
- `make services-up` works from `docker/services/`.
- `bash docker/tests/test-docker-builds.sh` builds both images (with the new `docker/images/` paths).
- Skill symlinks resolve (`cat libs/east-claude-plugin/skills/e3/SKILL.md` shows the e3 content); `generate-index` → `index.json` covers all seven skills incl. e3-ui; `search_east_examples` returns hits.
- A `scripts/scaffold/e3.sh` project builds + runs end-to-end on the new CLI (`e3 workspace deploy --from-zip`, `e3 dataflow run`, `e3 dataset get`).
- `scripts/install-dev.sh` on a clean machine: clone monorepo → `make install build link` → `e3 --version` works.
- **Smoke test the in-tree marketplace**: `claude plugin marketplace add <local east-workspace path>` → `claude plugin install east` → confirm all seven skills load and the symlinked SKILL.md content arrived in the cache (`~/.claude/plugins/cache/...`). Do this before decommissioning the old repo.
