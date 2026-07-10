# @elaraai/e3-cli

Command-line interface for e3 (East Execution Engine).

## Installation

```bash
npm install -g @elaraai/e3-cli
```

## Commands

Every command that takes `<repo>` accepts either a local path or an `http(s)://` URL. The transport is detected from the argument shape. Set `E3_REPO` to default the repo argument when omitted (where the positional is optional).

### Repository

```bash
e3 repo create <repo>                # Create a new repository
e3 repo status <repo>                # Show repository status
e3 repo remove <repo> [-r]           # Remove a repository (-r removes workspaces first)
e3 repo gc <repo> [--dry-run]        # Remove unreferenced objects
e3 repo list <server-url>            # List repositories on a server
```

### Packages

```bash
e3 package import <repo> <zip>            # Import package from .zip
e3 package export <repo> <pkg> <zip>      # Export package to .zip
e3 package list <repo>                    # List installed packages
e3 package remove <repo> <pkg>            # Remove a package
```

### Workspaces

```bash
e3 workspace create <repo> <name>                            # Create empty workspace
e3 workspace deploy <repo> <ws> <pkg>[@<ver>]                # Deploy a package
e3 workspace deploy <repo> <ws> --from-zip <path.zip>        # Import + create + deploy in one shot
e3 workspace export <repo> <ws> <zip>                        # Export workspace as a package
e3 workspace list <repo>                                     # List workspaces
e3 workspace status <repo> <ws>                              # Detailed workspace status
e3 workspace remove <repo> <ws>                              # Remove a workspace
```

### Datasets

Dataset paths use the flat form `<ws>.<name>`. The CLI resolves `<name>` against inputs and task outputs automatically.

```bash
e3 dataset get <repo> <ws.name> [-f east|json|beast2]
e3 dataset set <repo> <ws.name> <file> [--type <spec>] [--type-file <path>]
e3 dataset list <repo> <ws> [-l]                # List dataset paths (with -l for table view)
e3 dataset status <repo> <ws.name>              # Show one dataset's kind/type/status/size
e3 dataset find <repo> <ws> <pattern>           # Substring or glob (`*`, `?`) match across names
```

### Tasks

```bash
e3 task list <repo> <ws>                        # List tasks with execution status
e3 task logs <repo> <ws.task> [--follow]        # Stream task logs
```

### Dataflow execution

```bash
e3 dataflow run <repo> <ws> [--filter <p>] [--concurrency <n>] [--force] [-v]
```

`-v` / `--verbose` forwards `-v` to each task's runner so it prints a timing/perf
block to the task's logs (`e3 task logs <repo> <ws.task>`) — identical across
east-node, east-py and east-c. It is a runtime-only toggle that never affects
caching (a cached task stays cached; add `--force` to see the block for one).
Also on `e3 run`, `e3 call`, and `e3 mutate` — local and remote repositories
(remote carries it as a `?verbose=1` query param).

After a successful run, the CLI prints the task output paths so you can read them straight away:

```
Summary: 2 executed, 0 cached, ...
Outputs:
  dev.greet  String  14 B
  dev.shout  String  16 B
```

### Ad-hoc task execution

```bash
e3 run <repo> <pkg.task> <inputs...> -o <out>
e3 run <repo> <pkg@1.0.0.task> <in.beast2> -o <out.beast2> [-v]
```

### Watch / live development

```bash
e3 watch <source.ts> <repo> <ws> [--start] [--abort-on-change]
```

### Authentication

```bash
e3 auth login <server>      # OAuth2 device-flow login
e3 auth logout <server>     # Clear saved credentials
e3 auth status              # List saved credentials
e3 auth token <server>      # Print access token (curl integration)
e3 auth whoami [server]     # Show current identity
```

```bash
curl -H "Authorization: Bearer $(e3 auth token https://example.com)" \
  https://example.com/api/repos/my-repo/status
```

### Utilities

```bash
e3 convert [input] [--from <fmt>] [--to <fmt>] [-o <out>] [--type <spec>]
e3 completion install        # Detect your shell and wire up tab completion
e3 completion uninstall      # Undo the above
e3 completion {bash|zsh|fish}  # Print the raw script (manual install)
```

`e3 completion install` is the one-shot setup — it detects `$SHELL`, appends `eval "$(e3 completion bash)"` (or the zsh/fish equivalent) to your rc file, and is idempotent on re-run. Override detection with `--shell <bash|zsh|fish>`.

If you'd rather wire it up yourself, `e3 completion bash > /etc/bash_completion.d/e3` (and equivalents) work too.

The completion script delegates dynamic lookups (workspace names, dataset paths, package names) to a hidden `e3 __complete` handler.

### Defaulting the repository

When the positional `<repo>` is optional (every command that takes one as the first argument, except `run` and `watch`), the value is resolved in this order:

1. Explicit positional argument.
2. `E3_REPO` environment variable.
3. `.` (current directory).

So once you're inside a repo, `export E3_REPO=.` lets you drop the leading `.`:

```bash
export E3_REPO=.
e3 dataset get dev.greet
e3 dataflow run dev
```

## Migration from earlier versions

| Old                                              | New                                                   |
|--------------------------------------------------|-------------------------------------------------------|
| `e3 get <repo> <ws>.tasks.<name>.output`         | `e3 dataset get <repo> <ws>.<name>`                   |
| `e3 set <repo> <ws>.inputs.<name>`               | `e3 dataset set <repo> <ws>.<name>`                   |
| `e3 list <repo>`                                 | `e3 workspace list <repo>`                            |
| `e3 list <repo> <ws>`                            | `e3 dataset list <repo> <ws>`                         |
| `e3 status <repo> <path>`                        | `e3 dataset status <repo> <path>`                     |
| `e3 logs <repo> <ws>`                            | `e3 task list <repo> <ws>`                            |
| `e3 logs <repo> <ws>.<task>`                     | `e3 task logs <repo> <ws>.<task>`                     |
| `e3 start <repo> <ws>`                           | `e3 dataflow run <repo> <ws>`                         |
| `e3 login <server>` / `e3 logout <server>`       | `e3 auth login <server>` / `e3 auth logout <server>`  |
| `e3 workspace import <repo> <ws> <zip>`          | `e3 workspace deploy <repo> <ws> --from-zip <zip>`    |
| `e3 run <repo> <pkg>/<task>`                     | `e3 run <repo> <pkg>.<task>`                          |
| `e3 watch <repo> <ws> <source>`                  | `e3 watch <source> <repo> <ws>`                       |

## Example

```bash
# Create a repository, deploy a package, run the dataflow
e3 repo create ./my-project
e3 workspace deploy ./my-project dev --from-zip ./hello.zip
e3 dataset set ./my-project dev.name ./name.east
e3 dataflow run ./my-project dev

# Read the results
e3 dataset get ./my-project dev.greet
```

## Claude Code plugin

The East ecosystem also ships a [Claude Code](https://claude.com/claude-code) plugin — East language skills, example search, and preemptive diagnostics for East code — installed separately from the `elaraai` marketplace:

```text
# Inside Claude Code
/plugin marketplace add elaraai/east-workspace
/plugin install east@elaraai
```

```bash
# From a terminal
claude plugin marketplace add elaraai/east-workspace
claude plugin install east@elaraai
```

## License

BSL 1.1. See [LICENSE.md](./LICENSE.md).

### Ecosystem

- **[East](https://github.com/elaraai/east-workspace/tree/main/libs/east)**: Statically typed, expression-based language with serializable IR. Run portable logic across TypeScript, Python, C, and other runtimes.
  - [@elaraai/east](https://www.npmjs.com/package/@elaraai/east): Core language SDK with type system, expressions, and reference JS compiler

- **[East Node](https://github.com/elaraai/east-workspace/tree/main/libs/east-node)**: Node.js platform functions for I/O, databases, and system operations.
  - [@elaraai/east-node-std](https://www.npmjs.com/package/@elaraai/east-node-std): Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - [@elaraai/east-node-io](https://www.npmjs.com/package/@elaraai/east-node-io): SQLite, PostgreSQL, MySQL, MongoDB, Redis, S3, FTP, SFTP, XLSX, XML, compression
  - [@elaraai/east-node-cli](https://www.npmjs.com/package/@elaraai/east-node-cli): CLI for running East IR programs in Node.js

- **[East C](https://github.com/elaraai/east-workspace/tree/main/libs/east-c)**: C11 native runtime for executing East IR. Distributed via npm (launcher + per-platform optional dependencies) and as tarballs on each GitHub Release.
  - [@elaraai/east-c-cli](https://www.npmjs.com/package/@elaraai/east-c-cli): npm launcher — installs the matching native binary as an optional dependency
  - `east-c`: Core runtime — type system, IR interpreter, builtins, serialization (Beast2, JSON, CSV, East text)
  - `east-c-std`: Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - `east-c-cli`: CLI for running East IR programs natively

- **[East Python](https://github.com/elaraai/east-workspace/tree/main/libs/east-py)**: Python runtime, standard platform, I/O, and data-science platform functions. Published to PyPI.
  - [east-py](https://pypi.org/project/east-py/): Core Python runtime — type system, IR compiler, 212+ builtins, Cython-accelerated hot paths
  - [east-py-std](https://pypi.org/project/east-py-std/): Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - [east-py-io](https://pypi.org/project/east-py-io/): SQLite, PostgreSQL, MySQL, MongoDB, Redis, S3, FTP, SFTP, XLSX, XML, compression
  - [east-py-cli](https://pypi.org/project/east-py-cli/): CLI for running East IR programs in Python
  - [east-py-datascience](https://pypi.org/project/east-py-datascience/) (PyPI) + [@elaraai/east-py-datascience](https://www.npmjs.com/package/@elaraai/east-py-datascience) (npm): Optimization (MADS, Optuna, ALNS, GoogleOR), ML (XGBoost, LightGBM, NGBoost, PyTorch, Lightning, GP), Bayesian inference (PyMC), explainability (SHAP), conformal prediction (MAPIE)

- **[East UI](https://github.com/elaraai/east-workspace/tree/main/libs/east-ui)**: Typed UI component definitions and React renderer, plus VS Code preview.
  - [@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui): 50+ typed UI components for layouts, forms, charts, tables, dialogs
  - [@elaraai/east-ui-components](https://www.npmjs.com/package/@elaraai/east-ui-components): React renderer with Chakra UI v3 styling
  - [@elaraai/e3-ui](https://www.npmjs.com/package/@elaraai/e3-ui): e3 + UI bridge — Data bindings, `e3.ui()` task, manifest
  - [@elaraai/e3-ui-components](https://www.npmjs.com/package/@elaraai/e3-ui-components): React Query hooks and preview components for the e3 API
  - [east-ui-preview](https://marketplace.visualstudio.com/items?itemName=ElaraAI.east-ui-preview): VS Code extension for live East UI component preview

- **[e3 — East Execution Engine](https://github.com/elaraai/east-workspace/tree/main/libs/e3)**: Durable execution engine for running East pipelines at scale. Git-like content-addressable storage, automatic memoization, reactive dataflow, real-time monitoring.
  - [@elaraai/e3](https://www.npmjs.com/package/@elaraai/e3): SDK for authoring e3 packages with typed tasks and pipelines
  - [@elaraai/e3-core](https://www.npmjs.com/package/@elaraai/e3-core): Object store, dataflow orchestrator, execution state
  - [@elaraai/e3-types](https://www.npmjs.com/package/@elaraai/e3-types): Shared type definitions for e3 packages
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 repo`, `e3 package`, `e3 workspace`, `e3 start`, `e3 watch`, `e3 logs` commands
  - [@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client): HTTP client for remote e3 repositories
  - [@elaraai/e3-api-server](https://www.npmjs.com/package/@elaraai/e3-api-server): REST API server for e3 repositories
  - [@elaraai/e3-api-tests](https://www.npmjs.com/package/@elaraai/e3-api-tests): Shared API compliance test suites

## Links

- [East Language](https://github.com/elaraai/east-workspace/tree/main/libs/east)
- [Elara AI](https://elaraai.com/)
- [Issues](https://github.com/elaraai/east-workspace/issues)
- support@elara.ai

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
