# East Plugin for Claude Code

A Claude Code plugin for the East programming language ecosystem.

## Skills

| Skill | Package | Description |
|-------|---------|-------------|
| `east` | `@elaraai/east` | Core East language - types, expressions, compilation |
| `east-node-std` | `@elaraai/east-node-std` | Node.js platform functions (Console, FileSystem, Fetch, Crypto, Random, Time) |
| `east-node-io` | `@elaraai/east-node-io` | I/O platform functions (SQL, NoSQL, S3, FTP, XLSX, compression) |
| `east-py-datascience` | `@elaraai/east-py-datascience` | Data science & ML (MADS, Optuna, XGBoost, Torch, GP, SHAP) |
| `east-ui` | `@elaraai/east-ui` | UI components (50+ typed components for layouts, forms, charts) |
| `e3` | `@elaraai/e3` | East Execution Engine - durable execution for East pipelines |

## Example Search

The plugin includes a searchable index of East code examples extracted from the source repositories. This powers two features:

- **Hook** (`hooks/prompt-submit.js`) — automatically injects relevant examples into every prompt based on what you're asking
- **MCP tool** (`mcp/search-server.js`) — exposes a `search_east_examples` tool that Claude can call on-demand with targeted queries

The index (`index.json`) is generated from `*.examples.ts` files across all East packages and is kept in sync by the `update-skills` workflow.

### Generating the index locally

```bash
npm run generate-index -- --base-dir /path/to/source/repos
```

The `--base-dir` should point to a directory containing the cloned East source repos (`east/`, `east-node/`, `east-py/`, `east-ui/`). See `index.config.json` for the package-to-path mappings.

## Installation

**From GitHub:**
```bash
# Add the marketplace
/plugin marketplace add elaraai/east-plugin

# Install the plugin
/plugin install east
```

**From local directory (for development):**
```bash
# Add local marketplace
/plugin marketplace add /path/to/east-plugin

# Install the plugin
/plugin install east
```

## Project Scaffolding

Create new East projects with a single command:

**East project** (AGPL-3.0, Node.js only):
```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-plugin/main/scripts/project/east.sh | bash
```

**e3 project** (BSL-1.1, Node.js + Python):
```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-plugin/main/scripts/project/e3.sh | bash
```

| Script | License | Contents |
|--------|---------|----------|
| `scripts/project/east.sh` | AGPL-3.0 | east, east-node-std, east-node-io |
| `scripts/project/e3.sh` | BSL-1.1 | Everything in east + e3, east-py-datascience |

Generated projects include:
- TypeScript configuration with strict mode
- Makefile with `install`, `build`, `run`, `test`, `refresh` targets
- Example East function ready to build and run

## Local Installation

Install the East CLIs directly on your machine (Linux/macOS):

**For users** (installs CLIs from npm/PyPI):
```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-plugin/main/scripts/global/install.sh | bash
```

**For contributors** (clones all repos and builds from source):
```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-plugin/main/scripts/global/install-dev.sh | bash
```

| Script | What it does | Requirements |
|--------|--------------|--------------|
| `scripts/global/install.sh` | Installs CLIs globally from npm/PyPI, builds east-c from source | `curl`, `git`, `cmake`, `gcc` |
| `scripts/global/install-dev.sh` | Clones all repos to `~/east`, builds and tests them | `curl`, `git`, `make`, `cmake`, `gcc` |
| `scripts/global/update.sh` | Updates CLIs to latest versions | `npm` |
| `scripts/global/update-dev.sh` | Pulls latest and rebuilds all repos | `git`, `make` |

**Update CLIs** (fetches latest versions from npm/PyPI):
```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-plugin/main/scripts/global/update.sh | bash
```

**Update repos** (pulls latest commits and rebuilds from source):
```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-plugin/main/scripts/global/update-dev.sh | bash
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
docker build -f docker/Dockerfile.east-node -t ghcr.io/elaraai/east-node .

# Build e3 image (from repo root)
docker build -f docker/Dockerfile.e3 -t ghcr.io/elaraai/e3 .
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
