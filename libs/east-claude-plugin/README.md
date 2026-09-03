# East Plugin for Claude Code

A Claude Code plugin for the East programming language ecosystem.

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

## Example Search

The plugin includes a searchable index of East code examples extracted from the source repositories. Searching it is the most reliable way to learn idiomatic East usage — the API is large and pattern-heavy, so grounding in real examples beats reading `.d.ts` type signatures or guessing API shapes. It powers two features:

- **Hook** (`hooks/prompt-submit.js`) — automatically injects relevant examples into every prompt based on what you're asking
- **MCP tool** (`mcp/server.js`) — exposes a `search_east_examples` tool that Claude can call on-demand with targeted queries

The index (`index.json`) is generated from `*.examples.ts` files across all East packages (plus hand-written `index.static.json` stubs) and is kept in sync by the `plugin-artifacts` workflow.

### Generating the index locally

```bash
npm run generate-index -- --base-dir /path/to/source/repos
```

The `--base-dir` should point to a directory containing the cloned East source repos (`east/`, `east-node/`, `east-py/`, `east-ui/`). See `index.config.json` for the package-to-path mappings.

> **Use the search, not `.d.ts` files.** The East API is large and idiom-heavy; its `.d.ts` type signatures show shapes but not the runtime constraints and patterns that make East code correct. Learning the API by reading or grepping type definitions reliably produces broken code. The plugin steers both the main agent and subagents (via the SessionStart/SubagentStart hooks) to search the example index first.

## Diagnostics

The plugin runs preemptive East diagnostics whenever the agent reads or edits an East file (`PostToolUse(Read|Edit|Write)` → `hooks/diagnose.js`), injecting an `<east-code-review>` block into the agent's context that lists:

- **TypeScript errors** for the file (the checker's own semantic + syntactic diagnostics), and
- **East idiom issues** that plain `tsc` can't see — e.g. a redundant cast on a `$.let` value, a hand-rolled variant, `East.<X>Type` instead of a bare import, or `$.const`/`$.let` used inline in an expression.

The rules come from [`@elaraai/east-diagnostics`](../east-diagnostics) and run against a real `ts.Program` (type-aware, not regex). A python file that imports `east` gets the same treatment from the east-py rules (`east.diagnostics`, #638): the language server publishes them for a `.py` document the agent edits, and the read hook injects them, both through `east-py lint --format json` run from the project's own `.venv` (or `east-py` on PATH; `EAST_PY_LINT` names the command), silently skipped where there is none. A resident daemon (`daemon/server.js`) holds a warm `LanguageService` per project — started at `SessionStart`, keyed per plugin install so it is shared across sessions and tracks multiple projects at once — so reviews return in well under a second. Reads are reviewed once per distinct file-content (deduped), and vendored/built trees (`node_modules`, `dist`, …) are skipped. The same rule set is available to editors and CI via [`@elaraai/eslint-plugin-east`](../eslint-plugin-east).

## Installation

The monorepo root is a Claude Code plugin **marketplace** (`.claude-plugin/marketplace.json`, named `elaraai`), which lists the `east` plugin with `source: ./libs/east-claude-plugin`. Install it either from inside Claude Code (slash commands) or from a terminal (the `claude plugin` CLI).

### From the published marketplace (GitHub)

Inside Claude Code:
```text
/plugin marketplace add elaraai/east-workspace
/plugin install east
```

From a terminal:
```bash
claude plugin marketplace add elaraai/east-workspace
claude plugin install east@elaraai
```

### From a local checkout (development)

Point the marketplace at your local monorepo instead of GitHub. Build the plugin's artifacts first, since the marketplace copies whatever is on disk:

```bash
# 1. Refresh the committed artifacts the plugin ships (hooks bundle + search index)
cd ~/src/east-workspace
pnpm --filter '@elaraai/east-claude-plugin' run bundle          # -> .build/*.js
pnpm --filter '@elaraai/east-claude-plugin' run generate-index  # -> index.json
```

Inside Claude Code:
```text
/plugin marketplace add ~/src/east-workspace
/plugin install east@elaraai
```

From a terminal:
```bash
claude plugin marketplace add ~/src/east-workspace
claude plugin install east@elaraai
```

**Replacing an existing install:** the local marketplace is also named `elaraai`, so if you already added it from GitHub, remove that first (same name can't be registered twice):
```bash
claude plugin uninstall east
claude plugin marketplace remove elaraai
claude plugin marketplace add ~/src/east-workspace
claude plugin install east@elaraai
```

**Iterating on the plugin:** installed plugins are copied to `~/.claude/plugins/cache/elaraai/east/<version>/` (skill symlinks are dereferenced into the copy). Editing the working tree does **not** change the running plugin — after changes, re-run the `bundle` / `generate-index` commands above, then refresh the cache and restart the session:
```bash
claude plugin marketplace update elaraai   # re-read the local source
```

## Project Scaffolding

Create new East projects with a single command (cross-platform, via the
published `npm create` initializers — see [`libs/create`](../create)):

**East project** (AGPL-3.0, Node.js only):
```bash
npm create @elaraai/east my-project
```

**e3 project** (BSL-1.1, Node.js + Python):
```bash
npm create @elaraai/e3 my-project
```

| Initializer | License | Contents |
|-------------|---------|----------|
| `@elaraai/create-east` | AGPL-3.0 | east, east-node-std, east-node-io |
| `@elaraai/create-e3` | BSL-1.1 | Everything in east + e3, east-py-datascience |

Generated projects include:
- TypeScript configuration with strict mode
- Cross-platform npm scripts (`setup`, `build`, `test`, `start`, `watch`)
- Example East function / e3 task ready to build and run

## Local Installation

Install the East CLIs directly on your machine (Linux/macOS):

**For users** (installs CLIs from npm/PyPI):
```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-workspace/main/libs/east-claude-plugin/scripts/install.sh | bash
```

**For contributors** (clones all repos and builds from source):
```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-workspace/main/libs/east-claude-plugin/scripts/install-dev.sh | bash
```

| Script | What it does | Requirements |
|--------|--------------|--------------|
| `scripts/global/install.sh` | Installs CLIs globally from npm/PyPI, builds east-c from source | `curl`, `git`, `cmake`, `gcc` |
| `scripts/global/install-dev.sh` | Clones all repos to `~/east`, builds and tests them | `curl`, `git`, `make`, `cmake`, `gcc` |
| `scripts/global/update.sh` | Updates CLIs to latest versions | `npm` |
| `scripts/global/update-dev.sh` | Pulls latest and rebuilds all repos | `git`, `make` |

**Update CLIs** (fetches latest versions from npm/PyPI):
```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-workspace/main/libs/east-claude-plugin/scripts/update.sh | bash
```

**Update repos** (pulls latest commits and rebuilds from source):
```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-workspace/main/libs/east-claude-plugin/scripts/update-dev.sh | bash
```

Both install scripts install:
- `east-node` - East Node.js CLI
- `east-c` - East C CLI (built from source)
- `e3` - East Execution Engine CLI
- `east-py` - East Python CLI

## Docker Images

Pre-built Docker images provide a consistent execution environment without needing to install Node.js, Python, or any East packages locally.

### Images

| Image | License | Contents |
|-------|---------|----------|
| `ghcr.io/elaraai/east-node` | AGPL-3.0 | Node.js 22 + East + east-node-std/io + east-ui |
| `ghcr.io/elaraai/e3` | BSL + AGPL | Everything in east-node + Python 3.11 + east-py + east-c + e3 |

### Usage

```bash
# Pull images
docker pull ghcr.io/elaraai/east-node
docker pull ghcr.io/elaraai/e3

# Run East Node.js programs
docker run --rm -v $(pwd):/workspace ghcr.io/elaraai/east-node \
  npx @elaraai/east-node-cli run program.east

# Run e3 pipelines
docker run --rm -v $(pwd):/workspace -v ~/.e3:/root/.e3 ghcr.io/elaraai/e3 \
  e3 run my-pipeline

# Interactive shell
docker run -it --rm -v $(pwd):/workspace ghcr.io/elaraai/e3 bash
```

### Building Locally

```bash
# Build east-node image (from repo root)
docker build -f docker/images/Dockerfile.east-node -t ghcr.io/elaraai/east-node .

# Build e3 image (from repo root)
docker build -f docker/images/Dockerfile.e3 -t ghcr.io/elaraai/e3 .
```

### Firecracker Compatibility

These Docker images are compatible with Firecracker microVMs via:
- [Kata Containers](https://katacontainers.io/) - Run OCI images in Firecracker
- [Ignite](https://github.com/weaveworks/ignite) - `ignite run ghcr.io/elaraai/e3`
- AWS Lambda (uses Firecracker under the hood)

## Testing

Run all tests:
```bash
./tests/test-all.sh          # All tests including Docker builds
./tests/test-all.sh --quick  # Skip Docker builds
```

Individual test scripts:
| Script | What it tests |
|--------|---------------|
| `tests/test-scripts-syntax.sh` | Bash syntax validation for all scripts |
| `tests/test-project-east.sh` | East project scaffolding, install, build, run |
| `tests/test-project-e3.sh` | e3 project scaffolding, install, build, e3 export |
| `tests/test-docker-builds.sh` | Docker image builds |

## Links

- [East Language](https://github.com/elaraai/east)
- [East Node](https://github.com/elaraai/east-node)
- [East Python](https://github.com/elaraai/east-py)
- [East C](https://github.com/elaraai/east-c)
- [East UI](https://github.com/elaraai/east-ui)
- [e3 Execution Engine](https://github.com/elaraai/e3)
- [Elara AI](https://elaraai.com/)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

Before contributing, you must sign our [Contributor License Agreement (CLA)](CLA.md).

## License

This project is dual-licensed under AGPL-3.0 and commercial licenses. See [LICENSE.md](LICENSE.md) for details.

**Note:** The `ghcr.io/elaraai/e3` image contains BSL 1.1 licensed components. Production use requires a commercial license. Contact support@elara.ai.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
