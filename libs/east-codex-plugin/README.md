# East Plugin for Codex

The East programming language ecosystem for Codex: all 16 skills, tested example search, project detection, search-before-coding hooks, preemptive diagnostics, and both TypeScript/TSX and Python language servers.

The implementation is shared with the Claude Code plugin in [`../east-plugin`](../east-plugin). The plugin ships as the npm package `@elaraai/east-codex-plugin`, assembled at build time from this directory's manifests and bundles, the shared skills (adapted for Codex) and the example index — self-contained: installing it does **not** require a local clone, pnpm, a build, or a sibling `east-plugin` directory.

## Installation

Requires **Node.js 22+ on PATH** and a Codex client with `codex plugin` and lifecycle hooks. Python diagnostics additionally use your project's east-py installation; TypeScript diagnostics use your project's TypeScript and East dependencies.

### From the published catalog (no local clone)

The public catalog [elaraai/plugins](https://github.com/elaraai/plugins) is a Codex marketplace (`.agents/plugins/marketplace.json`, named `elaraai-codex`) whose entry is the npm package, pinned at the released version:

```bash
codex plugin marketplace add elaraai/plugins
codex plugin add east-codex-plugin@elaraai-codex
```

Codex fetches the package from npm and installs it as it is. You do not need to clone or build the East repositories yourself. The monorepo root keeps a marketplace of the same name whose entry points at the same package, so an install added as `elaraai/east-workspace` keeps updating. Pre-releases are the catalog's `beta` branch (`codex plugin marketplace add elaraai/plugins --ref beta`, named `elaraai-codex-beta`).

Start a **new Codex thread**. Open `/hooks` in the Codex CLI and review/trust the East hooks. Codex discovers `hooks/hooks.json`, but installation alone does not trust its commands. If your configuration disables hooks, enable them with `codex --enable hooks` (or `[features] hooks = true` in your Codex config).

Ask Codex to call `east_status`, then `search_east_examples` with `query: "array map"`. The status checks shipped artifacts, all skills, the index and project runtime prerequisites; `/hooks` shows whether hooks are actually trusted and active. Inspect MCP availability with `/mcp`.

**Updating the GitHub install:**

```bash
codex plugin marketplace upgrade elaraai-codex
codex plugin remove east-codex-plugin@elaraai-codex
codex plugin add east-codex-plugin@elaraai-codex
```

Start a new thread and review any changed hooks in `/hooks`.

### From a local checkout (development)

A checkout is a local marketplace once the plugin is assembled: `make -C libs/east-codex-plugin build` (or `make build` at the root) bundles the host and writes the plugin, with the marketplace files that name it, under `libs/east-plugin/marketplace/`, under the catalog's name `elaraai-codex` (one name registers once: adding the checkout points it there, adding `elaraai/plugins` points it back):

```bash
cd ~/src/east-workspace
make -C libs/east-codex-plugin build  # shared runtime + host build + bundles → ../east-plugin/marketplace/east-codex-plugin/
codex plugin marketplace add ~/src/east-workspace/libs/east-plugin/marketplace
codex plugin add east-codex-plugin@elaraai-codex
```

Start a new thread and review/trust the East hooks in `/hooks`. `codex plugin marketplace list` shows the configured sources.

**Iterating on the plugin:** installed plugins run from a cached copy. After editing source, rebuild as above, then reinstall to refresh the cache:

```bash
codex plugin remove east-codex-plugin@elaraai-codex
codex plugin add east-codex-plugin@elaraai-codex
```

This rebuild assumes your monorepo development dependencies are already installed and built, as for the Claude plugin. If examples changed, regenerate the index as described below before rebuilding.

Removing and reinstalling clears the old cache even when the manifest version has not changed. **Start a new thread**, then review changed hooks in `/hooks`. `marketplace upgrade` refreshes Git snapshots; use the remove/add cycle above for local source changes.

Both host packages declare `"@elaraai/east-plugin": "workspace:*"` in `package.json`. pnpm links the shared library during development, just like other monorepo dependencies. Bundling includes that library in each plugin's shipped JavaScript, so the assembled plugin runs independently of the workspace: that directory is what the release publishes as `@elaraai/east-codex-plugin` (see [`../east-plugin`](../east-plugin#publishing)).

If shared behavior changed, test both host plugins:

```bash
pnpm --filter '@elaraai/east-claude-plugin' test
pnpm --filter '@elaraai/east-codex-plugin' test
```

### Regenerating examples

If you changed the example corpus, build its dependencies and regenerate the shared index before bundling:

```bash
cd ~/src/east-workspace
make -C libs/east build
make -C libs/east-node build
pnpm --filter '@elaraai/east-py-datascience' run build
(cd libs/east-py && uv sync --all-packages)
pnpm --filter '@elaraai/east-plugin' run generate-index
make -C libs/east-codex-plugin build
```

The generator imports built example modules and uses east-py's printer through `uv`. It updates `libs/east-plugin/index.json`, the one committed artifact — commit it alongside the examples (CI's `plugin-artifacts` fails when it is stale). Nothing else generated is committed: the bundles, the adapted skills and the assembled plugin are build outputs.

## Skills


| Skill | Package | Description |
|-------|---------|-------------|
| `east` | `@elaraai/east` | Core East language - types, expressions, compilation |
| `east-node-std` | `@elaraai/east-node-std` | Node.js platform functions (Console, FileSystem, Fetch, Crypto, Random, Time) |
| `east-node-io` | `@elaraai/east-node-io` | I/O platform functions (SQL, NoSQL, S3, FTP, XLSX, compression) |
| `east-py` | `elaraai-east-py` | Python runtime - East expressions and East values as plain data, eager methods, @East.platform_function |
| `east-py-std` | `elaraai-east-py-std` | Standard platform functions on the Python runtime (direct `*_impl` calls) |
| `east-py-io` | `elaraai-east-py-io` | I/O platform functions on the Python runtime (direct `*_impl` calls) |
| `east-py-datascience` | `@elaraai/east-py-datascience` | Data science & ML (MADS, Optuna, XGBoost, Torch, GP, SHAP, Causal) |
| `east-ui` | `@elaraai/east-ui` | UI components (50+ typed components for layouts, forms, charts) |
| `e3` | `@elaraai/e3` | East Execution Engine - durable execution for East pipelines |
| `e3-ui` | `@elaraai/e3-ui` | e3 + UI bridge - reactive decision surfaces as e3 tasks (Data.bind, ui(), Diff, Ontology) |
| `e3-ui-cli` | `@elaraai/e3-ui-cli` | Render east-ui / e3-ui components to PNG/HTML (`e3-ui shot`), managed headless Chromium, server setup (`install-browser`, `doctor`) |
| `east-project` | _(plugin-native)_ | Create + manage East/e3 projects — scaffolds via `east-scaffold`, drives the build/deploy/run lifecycle |
| `east-design` | _(plugin-native)_ | Architect a solution before coding — discovery questions, capability→skill mapping, example searches, design doc |
| `east-ontology` | _(plugin-native)_ | Build an Economic Ontology of a business and render it with the e3-ui Ontology editor — elicitation methodology, node/link model, `OntologyType` encoding |
| `east-contribute` | _(plugin-native)_ | Contribute a change to the monorepo from a GitHub issue — triage → lib(s)/skills, anti-duplication discovery, East diagnostics + examples↔tests contract, build/test/lint + CI gates, issue → branch → PR |
| `e3-create` | `@elaraai/create-e3` | Scaffold e3 solutions and project templates |

Invoke a skill with `$east-codex-plugin:<skill-name>` or select it from Codex's skill picker. For example, use `east-design` to design a solution and `east-project` to scaffold and run it.

The single editable skill catalog is `../east-plugin/skills/`; package-owned skills there are symlinks to their owning libraries. **Edit the source.** `package` (run by `build`) dereferences every skill and adapts Claude-specific tool names and invocation syntax for Codex into the assembled plugin. Nothing in the installed skill set depends on a symlink outside the plugin.

## Example Search (MCP)

The legacy `.mcp.json` launcher sets `cwd: "."` (resolved by Codex relative to the installed plugin) and passes `./.build/mcp/server.js` to Node. Codex 0.154.0 passes these MCP arguments literally; `${PLUGIN_ROOT}` is available to hook commands but is not expanded in legacy MCP arguments. Keep the explicit working directory so startup works from any project directory.

- **`search_east_examples(query, language, format, limit, package)`**: ranked summaries of tested East programs; request `format: "full"` for code.
- **`get_east_example(id, language)`**: one complete example from a search result.
- **`east_status(directory)`**: installed artifacts and project readiness.
- **`east_lsp_diagnostics(file, timeout_ms, refresh)`**: diagnostics from either real language server, selected by file extension.

Program examples are stored as IR with TypeScript and Python renderings; JSX UI examples are TypeScript-only. Search before writing East code, fetch the relevant example, and follow its tested pattern. Do not learn East runtime rules by sweeping `.d.ts` or `*.examples.ts` files.

## Hooks and Diagnostics

| Capability | Codex integration |
|---|---|
| Project detection, skill guidance, diagnostics warmup | `SessionStart` |
| Guidance for subagents | `SubagentStart` |
| Search-before-coding reminder or refusal | `PreToolUse` for `apply_patch`, edits and recognized shell writes |
| Reminder when sweeping declarations/examples | `PreToolUse` for shell reads/searches and file read/search tools |
| File diagnostics | `PostToolUse` for patches, file reads/edits and recognized shell reads/writes |
| Session search tracking | `PostToolUse` for East example-search MCP tools |
| TypeScript/TSX language server | `.build/daemon/lsp.js`, reachable through MCP |
| Python language server | `.build/daemon/east-py-lsp.js`, reachable through MCP |

The default search gate adds guidance. Set `EAST_REQUIRE_SEARCH=deny` in the environment inherited by Codex to refuse an East write until a search is recorded. Tracking uses MCP hook events and a transcript fallback; it does not require a stable Codex transcript format.

Codex's documented plugin schema does not register `lspServers` natively. Both real LSP executables are included, with their stdio launch configuration in `.lsp.json` for compatible clients. The MCP bridge starts them on demand and keeps connections warm. Automatic post-edit reviews run through hooks using the same shared diagnostic rules, rather than depending on native LSP registration.

Call `east_lsp_diagnostics` with an absolute `.ts`, `.tsx` or `.py` path. It sends `initialize`, `didOpen`/`didChange` and `didSave` as appropriate and returns a diagnostic publication. Python's build tier can publish later: call again with `refresh: false` to retrieve the latest publication without restarting analysis. An empty publication can mean a file is outside the server's scope; a timeout is not a clean result. Use `east_status` to check runtime readiness.

TypeScript reviews use the shared warm diagnostics daemon and `@elaraai/east-diagnostics` rules. Python uses the project's own `east-py lsp`, with its existing lint fallback; `[tool.east-py] check = true` enables the opted-in build tier. Install east-py in the project's environment or set `EAST_PY_LINT` to its executable. Review blocks are deduplicated by session, path and file contents.

Shell path detection covers ordinary reads, redirects, heredocs, `tee`, `sed -i`, copies and moves. Dynamically computed paths, arbitrary scripts and hosted tool operations may not be visible to hooks; request explicit LSP diagnostics for those files. Hook coverage is not an enforcement boundary.

See the official [plugin packaging](https://developers.openai.com/plugins/build/plugins) and [hook documentation](https://learn.chatgpt.com/docs/hooks) for discovery, trust and tool event formats.

## Project Scaffolding

```bash
npm create @elaraai/east my-project
npm create @elaraai/e3 my-project
```

East projects include Node.js platform functions; e3 projects add durable execution and Python/data-science integrations. See [`../create`](../create) for project templates.

## Local CLI Installation

Install the East CLIs without maintaining a source checkout:

```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-workspace/main/libs/east-plugin/scripts/install.sh | bash
```

This installs npm/PyPI tools; east-c is built from a temporary source checkout by the script. It is separate from installing the Codex plugin.

For contributors who want the complete monorepo cloned and built:

```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-workspace/main/libs/east-plugin/scripts/install-dev.sh | bash
```

| Shared script | Purpose |
|---|---|
| `install.sh` | Install `east-node`, `e3`, `east-py`, and `east-c` |
| `install-dev.sh` | Clone the monorepo, install, build and link CLIs |
| `update.sh` | Update installed CLIs |
| `update-dev.sh` | Pull and rebuild the source workspace |

The `scripts/` shell entry points in this plugin delegate to those shared scripts.

## Testing

```bash
pnpm --filter '@elaraai/east-plugin' test
pnpm --filter '@elaraai/east-codex-plugin' test
pnpm --filter '@elaraai/east-claude-plugin' test
```

Tests cover patch parsing, search gating, shell reads, automatic diagnostics, every skill, and MCP + real LSP startup from an isolated installed copy with no plugin `node_modules` or sibling repositories — all over the assembled plugin, the thing that ships. CI also checks that the committed index remains current and that both plugins assemble.

## Contributing and License

See [CONTRIBUTING.md](CONTRIBUTING.md), [CLA.md](CLA.md), and [LICENSE.md](LICENSE.md). East is dual-licensed under AGPL-3.0 and commercial licenses. [Elara AI](https://elaraai.com/).
