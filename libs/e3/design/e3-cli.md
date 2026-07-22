# e3-cli: Command Line Interface

This document specifies the e3 command-line interface.

Every command that takes a `<repo>` argument accepts either a local filesystem path or an `http(s)://` URL — the transport is detected from the argument shape. Where the `<repo>` positional is optional (`[repo]`), it falls back to the `E3_REPO` environment variable, then to `.` (cwd). We never split commands by transport (no `e3 server …` etc.).

## Repository

```bash
e3 repo create <repo>                           # Create a new repository
e3 repo status <repo>                           # Show packages + workspaces
e3 repo gc <repo> [--dry-run]                   # Remove unreferenced objects
e3 repo remove <repo> [-r]                      # Remove repository (-r removes workspaces first)
e3 repo list <server-url>                       # List repositories on a server
```

## Packages

```bash
e3 package import <repo> <path.zip>             # Import package from local .zip
e3 package export <repo> <pkg>[@<ver>] <path.zip>
e3 package list <repo>                          # List installed packages
e3 package remove <repo> <pkg>[@<ver>]
```

## Workspaces

```bash
e3 workspace create <repo> <name>
e3 workspace deploy <repo> <ws> <pkg>[@<ver>]
e3 workspace deploy <repo> <ws> --from-zip <path.zip>   # Import + create + deploy
e3 workspace export <repo> <ws> <path.zip>
e3 workspace list <repo>
e3 workspace remove <repo> <ws>
e3 workspace status <repo> <ws>                 # Tasks, datasets, locks
```

`workspace deploy --from-zip` replaces the standalone `workspace import` command. Same three-step behaviour (package import + workspace create + deploy), but framed under the verb the user is actually performing.

## Datasets

Dataset paths use the flat form `<ws>.<name>`. The CLI resolves `<name>` against inputs and task outputs in the workspace tree. The on-disk storage form (`<ws>/inputs/<name>`, `<ws>/tasks/<name>/output`) is internal.

```bash
e3 dataset get <repo> <ws.name> [-f east|json|beast2]
e3 dataset set <repo> <ws.name> <file> [--type <spec>] [--type-file <path>]
e3 dataset list <repo> <ws> [-l]                # -l adds kind/type/status/size columns
e3 dataset status <repo> <ws.name>              # Detail for a single dataset
e3 dataset find <repo> <ws> <pattern>           # Substring or glob (`*`, `?`)
```

Errors include `did you mean` suggestions when a name doesn't resolve:

```
Error: 'dev.gret' not found in workspace 'dev'. Did you mean:
  dev.greet  (task-output)
```

`--type-file <path>` reads a `.east` type specification from a file — friendlier than escaping a nested type spec on the shell line.

## Tasks

```bash
e3 task list <repo> <ws>                        # List tasks with execution status
e3 task logs <repo> <ws.task> [-n <lines>] [--all] [--follow]   # Tail / page / follow logs
```

## Dataflow

```bash
e3 dataflow run <repo> <ws> [--filter <p>] [--concurrency <n>] [--force]
```

After a successful run, output paths are printed in flat form so the user can read them without re-discovering the structure:

```
Outputs:
  dev.greet  String  14 B
  dev.shout  String  16 B
```

## Ad-hoc task execution

```bash
e3 run <repo> <pkg.task> <inputs...> -o <out>
e3 run <repo> <pkg@1.0.0.task> <in.beast2> -o <out.beast2>
```

Task spec separator is `.`, matching the dotted path convention everywhere else in the CLI.

## Watch

```bash
e3 watch <source.ts> <repo> <ws> [--start] [--abort-on-change]
```

The source file is the first argument — the thing the user is editing leads.

## Authentication

```bash
e3 auth login <server>                          # OAuth2 device flow
e3 auth logout <server>
e3 auth status                                  # All saved credentials
e3 auth token <server>                          # Print bearer token (curl integration)
e3 auth whoami [server]
```

## Utilities

```bash
e3 convert <input> [--from <fmt>] [--to <fmt>] [-o <out>] [--type <spec>]
e3 completion {bash|zsh|fish}                   # Print installable completion script
```

Tab completion delegates dynamic candidates (workspace names, dataset paths, package names) to a hidden `e3 __complete <cword> <words...>` handler. Static parts (subcommand names, flag names, enum values) are baked into the shell script.

## Examples

```bash
# Bootstrap a project
$ e3 repo create .
$ e3 workspace deploy . dev --from-zip /tmp/hello.zip
$ e3 dataset set . dev.name name.east
$ e3 dataflow run . dev

# Read the result (flat form — no .tasks.X.output ceremony)
$ e3 dataset get . dev.greet

# Re-run after editing
$ e3 dataset set . dev.name newname.east
$ e3 dataflow run . dev

# With E3_REPO set, drop the repo arg
$ export E3_REPO=.
$ e3 dataset get dev.greet
$ e3 dataflow run dev
```

## Design notes

See `e3-cli-dx-refactor.md` for the rationale behind the current command tree and the path-resolution model.
