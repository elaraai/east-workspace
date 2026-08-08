# e3 User Guide

Usage guide for e3 (East Execution Engine) - a durable, content-addressable execution engine for East programs.

e3 provides git-like task management with cryptographic content addressing, allowing you to define dataflow pipelines that execute across multiple runtimes (Node.js, Python, Julia).

---

## Table of Contents

- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [SDK Reference](#sdk-reference)
- [CLI Reference](#cli-reference)
  - [Remote URLs](#remote-urls)
- [Project Setup](#project-setup)
- [Development Workflow](#development-workflow)
- [File Formats](#file-formats)

---

## Quick Start

### 1. Create a package

```typescript
// src/index.ts
import { East, IntegerType, StringType } from '@elaraai/east';
import e3 from '@elaraai/e3';

// Define an input
const name = e3.input('name', StringType, 'World');

// Define a task that uses the input
const greet = e3.task(
  'greet',
  [name],
  East.function([StringType], StringType, ($, n) =>
    East.str`Hello, ${n}!`
  )
);

// Bundle into a package
const pkg = e3.package('hello', '1.0.0', greet);

// Export for CLI import
await e3.export(pkg, '/tmp/hello.zip');
export default pkg;
```

### 2. Deploy and run

```bash
# Create a repository
e3 repo create .

# Import the package
e3 package import . /tmp/hello.zip

# Create a workspace and deploy
e3 workspace create . dev
e3 workspace deploy . dev hello@1.0.0

# Execute the dataflow
e3 dataflow run . dev

# Check the output
e3 dataset get . dev.greet
# Output: "Hello, World!"

# Change the input and re-run
e3 dataset set . dev.name name.east  # file containing: "Alice"
e3 dataflow run . dev
e3 dataset get . dev.greet
# Output: "Hello, Alice!"
```

### 3. Watch mode (development)

```bash
# Auto-deploy and run on file changes
e3 watch . dev ./src/index.ts --start
```

---

## Core Concepts

### Package

An immutable collection of inputs, tasks, and their compiled East IR. Created with `e3.package()` and exported to a `.zip` file.

### Workspace

A mutable environment where a package is deployed. Workspaces hold:
- Input dataset values (can be modified)
- Task outputs (computed by running tasks)
- Execution state and cache

### Task

A computation that reads input datasets and produces an output dataset. Tasks are defined with `e3.task()` using an East function, or `e3.customTask()` for shell commands.

### Dataflow

The DAG of tasks and their dependencies. When you run `e3 dataflow run`, tasks execute in dependency order. Cached results are reused when inputs haven't changed.

### Content Addressing

All objects (IR, data, results) are stored by SHA256 hash. This enables:
- Automatic deduplication
- Cache invalidation when content changes
- Integrity verification

---

## SDK Reference

### `e3.input(name, type, defaultValue?)`

Defines an input dataset. CLI users address it as `<ws>.${name}`; the on-disk storage path is `<ws>/inputs/${name}` but you never have to type that — the resolver handles the mapping.

```typescript
import { StringType, IntegerType, ArrayType } from '@elaraai/east';

// With default value
const name = e3.input('name', StringType, 'World');

// Without default (must be set before running)
const count = e3.input('count', IntegerType);

// Complex types
const items = e3.input('items', ArrayType(StringType), ['a', 'b', 'c']);
```

### `e3.task(name, inputs, fn, config?)`

Defines a task that runs an East function.

```typescript
import { East, IntegerType, StringType } from '@elaraai/east';

// Task with no inputs
const constant = e3.task(
  'constant',
  [],
  East.function([], IntegerType, ($) => {
    $.return(42n);
  })
);

// Task that depends on an input
const greet = e3.task(
  'greet',
  [name],  // input defined above
  East.function([StringType], StringType, ($, n) =>
    East.str`Hello, ${n}!`
  )
);

// Task that depends on another task's output
const shout = e3.task(
  'shout',
  [greet.output],
  East.function([StringType], StringType, ($, greeting) =>
    East.str`${greeting.toUpperCase()}!!!`
  )
);

// Default runner is east-node + @elaraai/east-node-std — every e3 project
// already has Node, so this resolves with no extra setup.

// Override with a typed runner — discriminated union of stock runtimes
// (east-py, east-node, east-c) plus a `custom` escape hatch for raw argv.
const pyTask = e3.task(
  'py_task',
  [someInput],
  East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
  { runner: { runtime: 'east-py', platforms: ['east-py-std'] } }
);

// east-c — native binary, lowest overhead for pure compute.
const fast = e3.task(
  'fast',
  [someInput],
  East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
  { runner: { runtime: 'east-c', platforms: ['east-c-std'] } }
);

// Same effect via the custom escape hatch (uv-wrapped east-py):
const wrapped = e3.task(
  'wrapped',
  [someInput],
  East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
  { runner: { runtime: 'custom', command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] } }
);
```

### `e3.partitionTask(name, spec, fn)`

Defines a task over huge collection datasets with bounded memory. e3 carves
the partitioned input(s) into key-range slices (deterministically, from the
dataset's segment index and the `targetPartitionBytes` knob), runs the body
once per partition as an ordinary content-addressed execution — parallel,
and memoized per partition — and assembles the one output dataset: shards
splice in partition order, or partials fold pairwise when `combine` is
given. The dataflow graph sees one task with one output, exactly like
`e3.task`.

```typescript
import { DictType, StringType, IntegerType } from '@elaraai/east';

const sales = e3.input('sales', DictType(SaleKeyType, SaleType));

// Row-local transform: each execution returns its shard of the output.
const cleaned = e3.partitionTask('cleaned', {
  partitions: [sales],
  output: DictType(SaleKeyType, SaleType),
}, ($, slice) => slice.filter(($, sale) => East.greater(sale.qty, 0n)));

// Aggregate to a small result: with `combine`, each execution returns a
// partial and the partials fold pairwise (combine must be associative).
const totals = e3.partitionTask('totals', {
  partitions: [sales],
  by: (_$, key) => key.sku,   // rows with equal by(key) never split apart
  output: DictType(StringType, IntegerType),
  combine: ($, a, b) => {
    $(a.mergeAll(b, ($, v1, v2) => v1.add(v2), ($, _k) => 0n));
    $.return(a);
  },
}, ($, slice) => /* aggregate the slice */ ...);
```

The body's parameters are the partition slices (each typed as its dataset's
own collection type), then any ordinary `inputs` in order. `by` must read a
leading prefix of every partitioned dataset's key — the key itself, one
leading field, or a struct of leading fields in order — and is validated
when the task is built. Two or more `partitions` entries co-partition
same-keyed Dict/Set datasets at shared boundary keys (the reconcile/delta
shape). Without `combine`, Dict/Set shard key ranges must ascend disjointly
in partition order — key-preserving and monotone re-keying transforms
qualify; anything else fails at splice naming the offending partitions.

Memoization is append-friendly: appends and tail-localized changes leave
earlier slices byte-identical, so their executions are served from the
cache; a mid-key-space insertion re-runs partitions from the insertion
point on.

### `e3.streamTask(name, spec, fn)`

Defines a one-pass streaming task: the runner feeds the `stream` input in
canonical order and the body writes its output incrementally through the
`emit` capability. State is ordinary `$.let` locals — exact left-fold
semantics, no parallelism, and any input change re-runs the whole pass.
Runs on every stock runtime: the output always streams through `emit`, and
every runner feeds the `stream` input lazily with O(segment) decoded memory
(segment-fed iteration and keyed reads; any other operation on it decodes
the whole value once).

```typescript
import { ArrayType } from '@elaraai/east';

const events = e3.input('events', ArrayType(EventType));

const balances = e3.streamTask('balances', {
  stream: events,
  output: ArrayType(BalanceType),
}, ($, events, emit) => {
  const balance = $.let(0.0);
  $.for(events, ($, event) => {
    $.assign(balance, balance.add(event.amount));
    $(emit({ at: event.at, balance }));
  });
});
```

`emit(key, value)` writes one Dict entry, `emit(element)` one Array/Set
element — in any order. Ascending Set/Dict emission streams straight to
the output file, and out-of-order emission is sorted by the runner's sink
(bounded-memory spill/merge, reported on stderr when it engages) before
the output is finalized, so the stored dataset is always the canonical
collection and a re-keying producer can emit rows as it reads them.
Duplicate Dict keys / Set elements are a runtime error. Omit `stream` for
a producer task whose body loops over platform-function sources (paginated
APIs, database cursors) and emits.

### `e3.customTask(name, inputs, outputType, command)`

Defines a task that runs a shell command instead of an East function.

```typescript
import { East, StringType, ArrayType } from '@elaraai/east';

const processData = e3.customTask(
  'process',
  [rawData],
  StringType,
  ($, input_paths, output_path) =>
    East.str`python process.py -i ${input_paths.get(0n)} -o ${output_path}`
);
```

### `e3.function(name, fn, config?)`

Define a named function — invoked by name with argument values, result
returned inline to the caller. Unlike a task it is not wired to datasets and
is not part of the dataflow graph; calling it writes nothing to the
repository. Think "stored procedure" for on-demand compute.

```typescript
const add = e3.function(
  'add',
  East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))
);

const pkg = e3.package('myapp', '1.0.0', someTask, add);
```

The signature (parameter and return types) is inferred from the East
function. The optional `config.runner` selects a known runtime
(`east-node`, `east-py`, `east-c`) — the raw-argv `custom` runtime is not
available for functions. Results are returned inline and capped (1 MB by
default over the API); results that don't fit belong in a task output
dataset instead.

### `e3.package(name, version, ...items)`

Bundles inputs and tasks into a package. Dependencies are collected automatically.

```typescript
// Only need to pass leaf tasks - dependencies are collected automatically
const pkg = e3.package('myapp', '1.0.0', finalTask);

// Or pass multiple items explicitly
const pkg = e3.package('myapp', '1.0.0',
  input1,
  input2,
  task1,
  task2
);
```

### `e3.export(pkg, zipPath)`

Exports a package to a `.zip` file for import into a repository.

```typescript
await e3.export(pkg, '/tmp/myapp.zip');
```

---

## CLI Reference

### Repository Commands

```bash
e3 repo create <repo>             # Create repository (local path or remote URL)
e3 repo remove <repo> [-r]        # Remove repository (-r to remove workspaces first)
e3 repo status <repo>             # Show repository status (packages, workspaces)
e3 repo gc <repo> [--dry-run]     # Remove unreferenced objects
```

The `repo remove` command will refuse to remove a repository that contains workspaces unless the `-r` (`--recursive`) flag is provided. With `-r`, all workspaces are removed before the repository is deleted.

### Package Commands

```bash
e3 package import <repo> <zipPath>       # Import package from .zip
e3 package export <repo> <pkg> <zipPath> # Export package to .zip
e3 package list <repo>                   # List installed packages
e3 package remove <repo> <pkg>           # Remove a package
```

### Workspace Commands

```bash
e3 workspace create <repo> <name>                            # Create empty workspace
e3 workspace deploy <repo> <ws> <pkg>[@<ver>]                # Deploy a package
e3 workspace deploy <repo> <ws> --from-zip <path.zip>        # Import + create + deploy in one shot
e3 workspace export <repo> <ws> <zip>                        # Export workspace as a package
e3 workspace list <repo>                                     # List workspaces
e3 workspace remove <repo> <ws>                              # Remove workspace
e3 workspace status <repo> <ws>                              # Detailed status (tasks, datasets, locks)
```

### Dataset Commands

Dataset paths use the flat form `<ws>.<name>`. The CLI resolves `<name>` against the workspace's inputs and task outputs automatically — no `.tasks.X.output` or `.inputs.X` ceremony.

```bash
e3 dataset get <repo> <ws.name> [-f east|json|beast2]
e3 dataset set <repo> <ws.name> <file> [--type <spec>] [--type-file <path>]
e3 dataset list <repo> <ws> [-l]                 # List paths (with -l for type/status/size table)
e3 dataset status <repo> <ws.name>               # Kind, type, status, size for one dataset
e3 dataset find <repo> <ws> <pattern>            # Substring or glob (`*`, `?`) match
```

Examples:

```bash
e3 dataset get . dev.name             # Read an input
e3 dataset get . dev.greet            # Read a task output
e3 dataset set . dev.name data.east   # Set an input from a file
e3 dataset find . dev '*output*'      # Find names matching a glob
```

The resolver gives `did you mean` suggestions on typos:

```
$ e3 dataset get . dev.gret
Error: 'dev.gret' not found in workspace 'dev'. Did you mean:
  dev.greet  (task-output)
```

`--type-file <path>` accepts a `.east` schema file in place of an inline `--type` string — handy when the type spec is too complex to escape on the shell.

### Task Commands

```bash
e3 task list <repo> <ws>                         # Tasks in workspace with execution status
e3 task logs <repo> <ws.task>                    # Last 200 lines of a task's logs
e3 task logs <repo> <ws.task> -n 50              # Last 50 lines
e3 task logs <repo> <ws.task> --all              # The whole log, however large
e3 task logs <repo> <ws.task> --follow           # Tail, then stream live output
```

Logs are shown from the end, since that is where a failure lands. When earlier
output was left out, a notice says so and how to get it; `--all` pages through
the whole log rather than holding it in memory. `--follow` picks up from the
current end of the log, so live output starts immediately regardless of how much
backlog there is.

### Dataflow Commands

```bash
e3 dataflow run <repo> <ws> [--filter <pattern>] [--concurrency <n>] [--force] [-v]
```

`-v` / `--verbose` forwards `-v` to each task's runner so it prints a timing/perf
block (load, compile, execute, output, total + peak RSS) to the task's logs
(`e3 task logs <repo> <ws>.<task>`). It is a pure runtime toggle: it never
affects task hashes or caching, so a cached task stays cached whether or not you
pass it — combine with `--force` to see the block for an already-cached task. The
same flag works on `e3 run`, `e3 call`, and `e3 mutate`, against **local and
remote** repositories (remote sends it as a `?verbose=1` query param). All three
known runtimes (east-node, east-py, east-c) print the identical block.

After a successful run, the CLI prints the resolved task output paths so you can read them straight away without having to walk the tree:

```
Summary: 2 executed, 0 cached
Outputs:
  dev.greet  String  14 B
  dev.shout  String  16 B
```

### Ad-hoc Run

```bash
e3 run <repo> <pkg.task> <inputs...> -o <out>
e3 run <repo> <pkg@1.0.0.task> <in.beast2> -o <out.beast2> [-v]
```

Task spec uses dots: `pkg.task` (or `pkg@version.task`). Slashes are no longer accepted.

### Call (named functions)

```bash
e3 call <repo> <pkg.fn> [args...]            # call by package: pkg.fn or pkg@1.0.0.fn
e3 call <repo> -w <ws> <fn> [args...]        # call the workspace's deployed package
e3 call <repo> <pkg.fn> 2 3 -o sum.beast2    # write raw result to a file
e3 call <repo> <pkg.fn> 2 3 -v               # print the runner's timing/perf to stderr (local repos)
```

Arguments are `.east` literals (`5`, `"hello"`, `[1.0, 2.0]`) or paths to
`.beast2` / `.json` / `.east` files, parsed against the function's declared
parameter types. On success the decoded result prints to stdout; failures
(wrong arity, runtime error, timeout, over-size result) exit non-zero with
a diagnostic. Calls are graph-free — they trigger no dataflow and leave the
repository byte-for-byte unchanged.

### Watch / Live Development

```bash
e3 watch <source.ts> <repo> <ws> [--start] [--abort-on-change]
```

The source file is the first argument — that's the thing you're editing, the rest is plumbing.

**Cancellation:** Press Ctrl-C in a running `e3 dataflow run` to abort it. In watch mode, `--abort-on-change` cancels in-flight runs when files change.

### Utilities

```bash
e3 convert [input] [--from <fmt>] [--to <fmt>] [-o <out>] [--type <spec>]
e3 completion install            # Detect $SHELL and wire up tab completion
e3 completion uninstall          # Undo
e3 completion {bash|zsh|fish}    # Print the raw script if you'd rather install it yourself
```

`e3 completion install` is the recommended way — it edits the right rc file once, idempotently. After install, restart your shell (or `source ~/.bashrc` / `source ~/.zshrc`).

Completion covers subcommands, flag names, format enums, workspace names, and dataset paths. Dynamic lookups go through a hidden `e3 __complete` handler.

### Authentication Commands

For remote servers that require authentication:

```bash
e3 auth login <server>            # OAuth2 device-flow login
e3 auth logout <server>           # Clear saved credentials
e3 auth status                    # List saved credentials
e3 auth token <server>            # Print access token (curl integration)
e3 auth whoami [server]           # Show current identity
```

The `e3 auth token` command is useful for debugging API calls with curl:

```bash
# Use token with curl
curl -H "Authorization: Bearer $(e3 auth token http://localhost:3000)" \
  http://localhost:3000/api/repos/my-repo/status
```

### Remote URLs

All commands that take a `<repo>` argument also accept HTTP URLs. Start a server with `e3-api-server`, then use the same CLI commands:

```bash
# Start a server (serves all repos under ./repos/)
e3-api-server --repos ./repos --port 3000

# All commands use the same URL format: http://server/repos/name
e3 repo create http://localhost:3000/repos/my-repo
e3 repo status http://localhost:3000/repos/my-repo
e3 repo remove http://localhost:3000/repos/my-repo

# Works the same for workspace and package commands
e3 workspace list http://localhost:3000/repos/my-repo
e3 workspace create http://localhost:3000/repos/my-repo dev
e3 package import http://localhost:3000/repos/my-repo ./pkg.zip
e3 workspace deploy http://localhost:3000/repos/my-repo dev myapp@1.0.0
```

**URL structure:**

```
User-facing URL:  http://localhost:3000/repos/my-repo
                  └──────────┬───────┘ └─────┬──────┘
                           origin      /repos/{name}

API endpoint:     http://localhost:3000/api/repos/my-repo/workspaces
                                        └─┬─┘
                                    inserted by CLI
```

The CLI automatically inserts `/api` when making requests. This keeps user-facing URLs clean (shareable, works in browser) while the server handles API routes under `/api/repos/...`.

---

## Project Setup

### TypeScript Project

```
my-e3-project/
├── package.json
├── tsconfig.json
├── pyproject.toml      # For Python runner (east-py)
├── src/
│   └── index.ts        # Package definition
└── repo/               # Repository (created by e3 repo create)
```

**package.json:**
```json
{
  "name": "my-e3-project",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "main": "node dist/index.js"
  },
  "dependencies": {
    "@elaraai/east": "^0.0.1-beta.11",
    "@elaraai/e3": "^0.0.2-beta.5"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

**pyproject.toml** (for Python runner):
```toml
[project]
name = "my-e3-project"
version = "1.0.0"
requires-python = ">=3.11"
dependencies = [
    "east-py>=0.0.1b11",
    "east-py-std>=0.0.1b11",
]

[tool.uv]
dev-dependencies = []
```

### Makefile (recommended)

```makefile
WORKSPACE ?= dev
PACKAGE_NAME ?= myapp
PACKAGE_VERSION ?= 1.0.0

build:
	npm run build

package: build
	npm run main

import: package
	e3 package import . /tmp/pkg.zip

deploy: import
	e3 workspace create . $(WORKSPACE) || true
	e3 workspace deploy . $(WORKSPACE) $(PACKAGE_NAME)@$(PACKAGE_VERSION)

run: deploy
	e3 dataflow run . $(WORKSPACE)

all: run

clean:
	rm -rf dist /tmp/pkg.zip
```

---

## Development Workflow

### Watch Mode

The fastest development workflow uses `e3 watch`:

```bash
e3 watch ./src/index.ts . dev --start
```

This:
1. Compiles your TypeScript on save
2. Exports and imports the package
3. Deploys to the workspace
4. Executes the dataflow
5. Repeats when files change

Use `--abort-on-change` to cancel running executions when you save:

```bash
e3 watch ./src/index.ts . dev --start --abort-on-change
```

### Manual Workflow

```bash
# Build and export
npm run build && npm run main

# Deploy in one step
e3 workspace deploy . dev --from-zip /tmp/pkg.zip

# Run
e3 dataflow run . dev

# Check results
e3 workspace status . dev
e3 dataset get . dev.mytask
```

### Caching

Tasks are cached by content hash. A task only re-runs when:
- Its East function IR changes
- Any of its input values change

Changing one task doesn't invalidate unrelated tasks. Use `--force` to bypass cache:

```bash
e3 dataflow run . dev --force
```

---

## File Formats

e3 supports three formats for data:

### .east (Human-Readable)

```east
42                      # Integer
"hello"                 # String
[1, 2, 3]              # Array
(name="Alice", age=30) # Struct
```

### .json

```json
{"type": "Integer", "value": "42"}
```

### .beast2 (Binary)

Compact binary format with self-describing types. Use for efficiency.

### Converting

```bash
e3 convert data.beast2                    # → .east (default)
e3 convert data.east --to beast2 -o out.beast2
e3 convert data.json --to east
```

---

## Tips

1. **Use watch mode** for fast iteration during development
2. **Let dependencies flow** - only pass leaf tasks to `e3.package()`, dependencies are collected automatically
3. **Check status** with `e3 workspace status . <ws>` to see task states
4. **View logs** with `e3 task logs . workspace.taskname` for debugging (add `--all` for the whole log)
5. **Use inputs** for values that change between runs, tasks for computations
