# e3 CLI DX Refactor

## Motivation

The current CLI has accumulated several inconsistencies that cost users (and agents) repeated wrong guesses. The most visible symptom: an agent typically needs 10–15 iterations of `e3 list` / `e3 get` to find the right path to read a value, because the same task has three different addresses, the ceremonious `tasks.X.output` form is unguessable from the source, and error messages don't suggest fixes.

This doc consolidates a series of targeted fixes. Each section names the problem, the proposed change, and whether it is breaking.

---

## 1. Address space: flatten dataset paths

### Problem

A task `greet` in workspace `dev` has three different addresses today:

```
e3 get  . dev.tasks.greet.output      # requires "tasks." prefix AND ".output" suffix
e3 logs . dev.greet                   # no prefix, no suffix
e3 run  . mypkg@1.0.0/greet           # package-relative, slash + @version
```

Inputs follow yet another scheme: `dev.inputs.name`. The user's source code says `e3.input('name', ...)` and `e3.task('greet', ...)` — there is no hint in the SDK that the runtime path requires `inputs.` and `tasks.X.output` ceremony.

Reality check: the only addressable leaves in a workspace are inputs (one per `e3.input`) and task outputs (one per `e3.task`). The `tasks.` and `inputs.` prefixes are partition labels with no information value at the CLI layer. The `.output` suffix is always present and always required — it conveys zero information.

### Proposal

Single canonical address everywhere:

```
<ws>.<name>
```

- `dev.name` — input named `name`
- `dev.greet` — output of task `greet`
- `dev.greet.field` — field of a struct-typed task output (or named sub-output if multi-output tasks are added)

Same form for `get`, `set`, `status`, `logs`, `run`. Same form whether `name` is an input or a task. The SDK already guarantees input and task names occupy a flat per-workspace namespace, so there is no ambiguity to resolve.

Drop the alternates entirely — no `tasks.`/`inputs.` prefix support, no `.output` suffix support. Two forms = back to the agent-confusion problem; one form is the point.

### Future-proofing: multi-output tasks

If a task ever needs to produce several artefacts, do it through the type system: return a struct, and the SDK destructures it into siblings.

```typescript
e3.task('train', [...], East.function([...], StructType({
  model: ModelType,
  metrics: MetricsType,
  loss: ArrayType(FloatType),
}), ...))
```

Addresses: `dev.train.model`, `dev.train.metrics`, `dev.train.loss`. Same flat scheme. No special slot needed.

### Breaking

Yes — `dev.tasks.greet.output` and `dev.inputs.name` stop working. Acceptable at the current pre-1.0 stage; document the migration in USAGE.md with a side-by-side table.

---

## 2. Helpful error messages

### Problem

When `e3 get . dev.greet` fails today, the error is "field not found" or "is a tree" with no guidance. The agent has to guess the next form.

### Proposal

Three kinds of suggestion:

**Not-a-dataset**: when a path resolves to a tree, list its leaves.
```
$ e3 get . dev.train
Error: 'dev.train' is a struct, not a scalar. Children:
  dev.train.model    (ModelType, set)
  dev.train.metrics  (MetricsType, set)
  dev.train.loss     (Array Float, set)
```

**Not-found with similar names**: fuzzy-match against datasets in the workspace.
```
$ e3 get . dev.greeting
Error: 'dev.greeting' not found in workspace 'dev'. Did you mean:
  dev.greet     (task output, String)
  dev.greeter   (input, String)
```

**Wrong workspace**: when the workspace doesn't exist, list available workspaces.
```
$ e3 get . staging.greet
Error: workspace 'staging' not found. Available:
  dev
  prod
```

### Breaking

No — pure addition.

---

## 3. Tab completion

### Problem

No shell completion today. Discovery requires repeated `e3 list` calls.

### Proposal

Standard two-piece approach (matches git, kubectl, npm):

1. **Installable completion scripts**:
   ```
   e3 completion bash > /etc/bash_completion.d/e3
   e3 completion zsh > "${fpath[1]}/_e3"
   e3 completion fish > ~/.config/fish/completions/e3.fish
   ```

2. **Hidden delegation subcommand**:
   ```
   e3 __complete <words...>
   ```
   Emits newline-separated candidates. The shell scripts call this for everything dynamic (workspace names, dataset paths, package names, task names). Static lists (subcommands, flag names) are baked into the shell scripts.

Completion covers every dynamic argument the CLI accepts, not just dataset paths. The completion script knows the command context (which subcommand the cursor is in and which positional argument is being typed) and asks `e3 __complete` for the right candidate kind:

| Context | Candidates | Source |
|---|---|---|
| `e3 <TAB>` | subcommand names | static |
| `e3 dataset <TAB>` | subcommand names | static |
| `e3 dataset get --<TAB>` | flag names | static |
| `e3 dataset get --format <TAB>` | `east json beast2` | static |
| `e3 <verb> <TAB>` (repo arg) | `.`, `$E3_REPO`, recent server URLs from `~/.e3/credentials` | mixed |
| `e3 workspace remove <TAB>` | workspace names | `workspaceList` |
| `e3 workspace deploy . dev <TAB>` | package names | `packageList` |
| `e3 workspace deploy . dev hello@<TAB>` | installed versions of `hello` | `packageList` (filtered) |
| `e3 dataset get <TAB>` | workspace names | `workspaceList` |
| `e3 dataset get dev.<TAB>` | dataset paths under `dev` | `datasetListRecursivePaths` |
| `e3 dataset set dev.x <TAB>` | local filenames | shell default |
| `e3 task logs <TAB>` | workspace names | `workspaceList` |
| `e3 task logs dev.<TAB>` | task names in `dev` | `taskList` |
| `e3 dataflow run <TAB>` | workspace names | `workspaceList` |
| `e3 package remove . <TAB>` | installed package names | `packageList` |
| `e3 auth login <TAB>` | recent server URLs | `~/.e3/credentials` |
| `e3 auth token <TAB>` | logged-in server URLs | `~/.e3/credentials` |
| `e3 auth logout <TAB>` | logged-in server URLs | `~/.e3/credentials` |

Dynamic queries are capped at ~100 candidates and filtered by the current prefix server-side where the underlying function supports it (`datasetListRecursivePaths` does; others return the full set and filter client-side).

### Caveat

Tab completion helps interactive humans. Agents pipe Bash without a TTY and never see TAB. The agent-facing equivalents are §1 (predictable paths), §2 (error suggestions), and `e3 dataset find` (§4).

### Breaking

No — pure addition.

---

## 4. Command structure: one verb per noun

### Problem

Verbs float at three levels:

- Subcommand groups (good): `e3 repo|package|workspace <verb>`
- Top-level verbs that should be grouped: `e3 list|get|set|status|run|start|logs`
- Mixed for auth: `e3 login` and `e3 logout` are top-level, but `e3 auth status|token|whoami` are nested

This creates three specific collisions:
- Three different `status` commands (`repo status`, `workspace status`, top-level `status` for datasets)
- Two ways to list workspaces (`e3 list .` and `e3 workspace list .`)
- `e3 repo list` takes a server URL, not a repo — different domain entirely

### Proposal

Every verb under its noun. One top-level alias (`init`) for the most common bootstrap.

```
e3 init [path]                                 # alias for: repo create .
e3 repo create|remove|status|gc|list           # 'list' takes a server URL — same command, different argument shape
e3 package add|remove|list|export              # 'add' = npm-style; 'import' is the underlying op
e3 workspace create|remove|list|status|deploy|export|unlock
e3 dataset get|set|list|status|find            # 'find' = pattern search across paths
e3 task logs|list                              # 'task list' replaces 'e3 logs <ws>' overload
e3 dataflow run|cancel                         # was: e3 start; 'cancel' is missing today
e3 auth login|logout|status|token|whoami       # all under auth
e3 watch <source> [<ws>]                       # rearranged (see §6)
e3 convert <input> ...                         # unchanged
e3 completion bash|zsh|fish                    # new (§3)
```

**Local-or-remote is always argument-driven, never command-driven.** A given verb works whether you pass it `.` or `https://...`. We do not split commands by transport. `dataflow cancel` on a local repo reads the workspace lock's PID and signals it; on a remote repo it calls `dataflowCancel`. Same CLI surface, different mechanism inside.

`e3 run` for ad-hoc package-task execution stays at top level, since it doesn't fit any of these nouns cleanly (it operates on a package + task pair, not a workspace).

### Breaking

Yes. Keep current top-level forms as hidden aliases that emit a one-line deprecation note for one minor cycle, then drop.

---

## 5. Global ergonomics

### Problem

Every command takes `<repo>` positionally, almost always `.`. No machine-readable output flag. No confirmation for destructive ops. No way to clear a stuck workspace lock.

### Proposal

- **`--repo` / `-R` flag + `E3_REPO` env var**. Positional `<repo>` becomes optional and defaults to `$E3_REPO` then `.`. Reduces typing for every invocation.
  ```bash
  # Today
  e3 get . dev.greet
  # After
  E3_REPO=. e3 dataset get dev.greet
  # or
  e3 dataset get -R . dev.greet
  ```

- **`--json` everywhere**. One flag for machine-readable output, applied uniformly. Today only `e3 get -f json` exists.

- **`--yes` / `-y` for destructive ops**. `workspace remove`, `package remove`, `repo remove`. Bare destructive commands print a "this will delete X" confirmation and require either interactive `y` or `-y`.

- **`e3 workspace unlock <ws>`**. `e3 workspace status` already surfaces lock info; there is no documented way to clear a stale lock today.

- **Hash truncation**: pick one width (suggest 12) and use it everywhere. Currently varies between 8 and 12.

- **Resolved version in deploy output**: `e3 workspace deploy . dev hello` should print `Deployed hello@1.0.0 to dev`, not `Deployed hello@latest to dev`.

### Breaking

`--repo` / `E3_REPO` / `--json` / `--yes` / `e3 workspace unlock` are pure additions. Hash width and deploy output are cosmetic and trivially safe.

---

## 6. Argument ordering

### Problem

`e3 watch <repo> <workspace> <source>` puts the workspace in the middle. Everywhere else the structural pattern is `<repo> <thing being operated on> [<auxiliary>]`. In `watch` the "thing being operated on" is the source file, not the workspace.

### Proposal

```
e3 watch <source> [<ws>]
```

With `-R`/`E3_REPO` (§5), the common case becomes:
```
e3 watch ./src/index.ts dev
```

Workspace defaults to a value derived from the package name, or requires explicit specification when ambiguous.

### Breaking

Yes. Hidden alias accepting old order for one cycle.

---

## 7. Path syntax in `e3 run`

### Problem

`e3 run` is the only command that uses slashes for paths:
```
e3 run . mypkg/greet
e3 run . mypkg@1.0.0/greet
```

Everything else uses dots.

### Proposal

Use dots, with `@version` retained for explicit package versions:
```
e3 run . mypkg.greet              # latest version
e3 run . mypkg@1.0.0.greet        # explicit version
```

This matches dataset path conventions and removes the special slash separator.

### Breaking

Yes. Hidden alias for one cycle.

---

## 8. `set --type` is hostile

### Problem

For `.json` and `.csv` files, the user must write a `.east` type spec inline:
```
e3 set . dev.x data.csv --type ".Array .Struct [{name: \"x\", type: .Integer}]"
```

Escaping is brittle. Composing types longer than two levels deep is unworkable on a shell line.

### Proposal

Accept a type schema file:
```
e3 dataset set dev.x data.csv --type-file schema.east
```

Where `schema.east` contains the same `.east` expression with no shell escaping. Keep `--type` as the inline form for trivial cases (`--type .Integer`).

### Breaking

No — pure addition.

---

## 9. Output discoverability after `start` / `run`

### Problem

After `e3 start . dev`, the user has to either remember or rediscover the output paths to read results. This is one of the routes that costs agents the most iterations.

### Proposal

Print outputs at the end of `start` and `run`:

```
$ e3 dataflow run dev
  [DONE] greet [12ms]
  [DONE] shout [4ms]

Summary: 2 executed, 0 cached
Outputs:
  dev.greet  String   "Hello, World!"...
  dev.shout  String   "HELLO, WORLD!!!"...
```

Truncate values at e.g. 60 chars; full read requires `e3 dataset get`. The first line of every value is enough for agents to confirm the task did what they expected without an extra round-trip.

### Breaking

No — pure addition.

---

## 10. Smaller cleanups

- `e3 list` defaulting to recursive when targeting a workspace (`e3 dataset list dev` shows all leaves). Add `--shallow` for the current one-level behaviour.
- Remote `gc` polling: replace "Running garbage collection..." with a per-poll progress line (`Scanned N objects, M MB reclaimed`).
- `e3 workspace export` accepts `<ws>` `<zip>` `[<pkg>[@<ver>]]` positionally instead of `--name`/`--version` flags.

---

## Migration plan

Stage in two PRs:

### PR 1 — Address space + suggestions (no completion)

- Resolver: `<ws>.<name>` is the canonical path. Drop `tasks.X.output` and `inputs.X` support entirely.
- Helpful errors with "did you mean" suggestions (§2).
- Print outputs after `start`/`run` (§9).
- `e3 list` defaults to recursive in workspace context (§10).
- USAGE.md: side-by-side migration table.

PR 1 is the bulk of the agent-friction win.

### PR 2 — Tab completion + command-tree refactor

- `e3 completion {bash,zsh,fish}` + `e3 __complete` hidden subcommand (§3).
- New noun-per-verb command tree (§4); old top-level forms kept as hidden, deprecated aliases for one minor cycle.
- `--repo` / `E3_REPO` / `--json` / `--yes` (§5).
- `watch` argument reorder (§6).
- `run` dot-syntax (§7).
- `set --type-file` (§8).

### PR 3 (optional / later)

- `e3 workspace unlock` (§5).
- Hash width unification (§5).
- Resolved version in deploy output (§5).
- Cosmetic / cleanup items from §10.

---

## Out of scope

- A `.e3config` config file (analogous to `.gitconfig`). Worth considering once `--repo` and `E3_REPO` land, to see whether real users want it.
- Interactive REPL / TUI mode. The existing `e3 view` TUI design (see `VIEWER.md`) is the right vehicle; the CLI itself should stay non-interactive.
- A package registry. `e3 package add` in §4 is named to leave room for registry-fetch later, but the immediate behaviour is identical to `package import`.
