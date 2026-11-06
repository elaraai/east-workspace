# The e3 CLI

Part of the `e3` skill.

Every `<repo>` is a local path or a server URL, `http(s)://<host>/repos/<name>`;
where `[repo]` is optional it defaults to `$E3_REPO`, then `.`. Dataset paths are
flat, `<ws>.<name>` — an input or a task output, with "did you mean" suggestions;
a task is `<ws>.<task>` and a mutation `<record>.<mutation>`.

| Command | Does |
|---|---|
| **Repositories** | |
| `e3 repo create [repo] [--exist-ok]` | Create one (`--exist-ok`: succeed if it exists). |
| `e3 repo status [repo]` · `e3 repo remove [repo] [-r]` | Show objects, packages, workspaces · remove (`-r`: its workspaces first). |
| `e3 repo gc [repo] [--dry-run] [--keep-runs <n>] [--keep-days <d>] [--min-age <ms>]` | Drop old run history, then what nothing names (below). |
| `e3 repo list <server>` | The repositories a server holds. |
| **Packages** | |
| `e3 package import [repo] <zip>` · `export [repo] <pkg[@ver]> <zip>` | Import · export (`--quiet`: errors only). |
| `e3 package list [repo]` · `remove [repo] <pkg[@ver]>` | |
| **Workspaces** | |
| `e3 workspace create [repo] <ws>` · `list [repo]` · `status [repo] <ws>` · `remove [repo] <ws>` | `status` shows tasks, datasets and locks. |
| `e3 workspace copy [repo] <from> <to>` | Make `<to>` what `<from>` is now — its package and every input, record and task output, so nothing runs again — made, or replaced whole with its runs. It writes refs only, so its cost follows the number of datasets, never their size; a write to either afterwards leaves the other as it was. Refused while a dataflow runs in `<to>`. |
| `e3 workspace deploy [repo] <ws> <pkg[@ver]>` | Deploy an imported package. |
| `… --from-zip <zip>` · `… --from-source <src.ts> [--functions <manifest…>]` | Import the zip (or bundle the source) and deploy, creating the workspace. |
| `… [--schema <policy>] [--inputs <policy>] [--allow-drop-records] [--plan] [--skip-file-sources] [-j <n>] [--memory <size>] [--quiet]` | A record's policy, an input's, and `file` sources; says how far it has got (below), `--quiet` aside. `-j`: the `file` sources taken in at once, and the runner processes their intake units, the migrations and the index builds run on, and with `--from-source` the workspace packages exporting their functions at once; `--memory`: what those may reserve (local). |
| `e3 workspace export [repo] <ws> <zip> [--name <n>] [--version <v>]` | The workspace's state as a package. |
| **Datasets** | |
| `e3 dataset get [repo] <ws.name> [-f east\|json\|beast2]` | Print a value. |
| `e3 dataset set [repo] <ws.name> <file> [--type <spec> \| --type-file <path>]` | Write from `.east`, `.beast2`, `.json` or `.csv` (JSON and CSV need the type). |
| `e3 dataset set [repo] <ws.name> --from-file <path.beast2> [-j <n>] [--memory <size>]` | Take a beast2 file in as the value, as a deploy takes a `file` source in, saying how far it has got; `-j`, `--memory`: the budget its intake units run under (local). |
| `e3 dataset list [repo] <ws> [-l]` · `status [repo] <ws.name>` · `find [repo] <ws> <pattern>` | Paths (`-l`: kind, type, status, size) · one dataset · by substring or glob. |
| **Running** | |
| `e3 dataflow run [repo] <ws> [--filter <task>] [--force \| --force-task <task>…] [-j <n>] [--memory <size>] [-v]` | Run what is stale, then print the outputs' paths. `--filter`: one task, by its exact name, and the tasks it depends on. `--force`: re-run every task the run runs (under `--filter`, its task); `--force-task`, repeated for each: re-run the tasks it names, whose dependents re-run when an output changes. A task the graph lacks, or one `--filter` leaves out, refuses the run. A task whose input nothing has set — an input never set, or a record declared with no initial value and not yet seeded — is left waiting, with its dependents (`[WAIT]`, `Waiting:`), and the run completes without them; they run once it is set. |
| `e3 task list [repo] <ws>` | Tasks with the status of each one's latest run. |
| `e3 task logs [repo] <ws.task> [-n <lines>] [--all] [--follow] [--execution <task>/<inputs>/<id>]` | The last 200 lines by default, of the latest attempt over the task's current inputs, or its latest run; `--follow` stays on that execution; `--execution`: one unit's log, as a split task's log names it (local). |
| `e3 run <repo> <pkg[@ver].task> [inputs.beast2…] -o <out> [--force] [-v] [-j <n>] [--memory <size>]` | Run one task ad hoc. |
| `e3 call <repo> <pkg[@ver].fn> [args…] [-o <out.beast2>] [-j <n>] [--memory <size>] [-v]` · `e3 call <repo> -w <ws> <fn> [args…]` | Call a function; each argument is an `.east` literal or a `.beast2`/`.json`/`.east` file, and with `-w` one written `@<keypath>` (`@.inputs.sales`) is that dataset of the workspace, pinned at its hash when the call starts. A function that declares `inputs` reads them from the workspace itself, so it takes its arguments alone and is called with `-w`; without it, it is refused, naming its inputs. |
| **Records** (`-w <ws>` required) | |
| `e3 mutate <repo> <record.mutation> [args…] -w <ws> [-j <n>] [--memory <size>] [-v]` | Apply a mutation. |
| `e3 seed <repo> <record> <file.beast2> -w <ws> [-j <n>] [--memory <size>]` | Commit a record's first state from a beast2 file, as its `$init`: for a record declared with no initial value, unassigned until then (local). The file is taken in as a `file` source is, never read whole; a record that holds a state is refused. |
| `e3 history <repo> <record> -w <ws> [--limit <n>] [--from <hash>] [--delta]` | Commits, newest first (`--delta`: what each changed, per target — a summary's totals added to as `±n`; local). |
| `e3 reindex <repo> <record> -w <ws> [--index <name>] [-j <n>] [--memory <size>]` · `e3 compact <repo> <record> -w <ws>` | Rebuild indexes (local) · collapse the history to a `$compact` root, the state kept. |
| **Development** | |
| `e3 watch <src.ts> <repo> <ws> [--start] [--schema <p>] [--inputs <p>] [--abort-on-change] [--functions <manifest…>] [-j <n>] [--memory <size>]` | Redeploy on each change (and run, with `--start`). |
| `e3 convert [input] [--from <f>] [--to <f>] [--type <spec>] [-o <out>]` | Convert between `.east`, `.json` and `.beast2`. |
| `e3 completion install [--shell <s>]` · `uninstall` · `bash` \| `zsh` \| `fish` | Shell completion. |
| **Servers** | |
| `e3 auth login <server> [--no-browser]` · `logout <server>` · `status` · `token <server>` · `whoami [server]` | OAuth2 device flow; credentials per server (`token` prints one for curl). |

**The budget.** `-j`/`--jobs <n>` is the cores — runner processes in flight, a
task or a unit each — and `--memory <size>` (`8G`, `512M`) what they may reserve
between them. The defaults are `E3_JOBS` and `E3_MEMORY`, else what e3 may use:
its CPU affinity capped by a cgroup quota, and the cgroup's `memory.max` or
physical memory, less a reserve. A unit of a split task reserves the largest
peak a unit of its stage has reached in the run. On Linux and macOS a guard
stops the newest unit when the runners together pass the budget, and runs it
again once it fits, so there a stage starts all its units at once, each
reserving the task's last peak or, the first time, what the largest piece
holds of its rows decoded, as its program reads them; on Windows a stage runs
its first unit alone and then fans out. A deploy
takes its `file` sources in `-j` at a time, their pieces' intake units running
under the same budget. A source deploy, or a `watch`, exports the workspace
packages its imported functions come from `-j` at a time, a process each, on
this machine; against a server, as many at once as this machine has CPUs. The
commands that run East — `workspace deploy`,
`dataset set --from-file`, `dataflow run`, `run`, `call`, `mutate`, `seed`,
`reindex` and `watch` — take the flags for a local repository; against a server the CLI
refuses them, since the server runs the work under its own budget
(`e3-api-server -j`, `--memory`).

**A deploy says how far it has got**, on stderr. Each `file` source prints a
line once it is in: its size, time and rate, and how it was taken in
(`unchanged, already in the store`, `taken in by east-c`, or `carried` for a
value that is not a collection), with why the first time a runner fell back to
another. A terminal also keeps a live line for the files in flight, with their
pieces, the rate and the time left across them. A source deploy prints a line
for each workspace package whose functions it links: `exported <n> function(s)
of <pkg> (east-py export-functions)`, or `reused <n> function(s) of <pkg>,
unchanged since its last export` when the export cache held them. Against a
server, the deploy line
says what the job is doing, such as migrating a record or building an index;
the deliveries then upload a few at a time, each printing a line once it is in,
and the live line says what the server's commit is doing with each in flight.
While a deploy runs, its lock carries the same progress for `e3-ui` or any
client to read (`workspaceLockStatus`). A workspace deployed for the first time
has no status until its deploy ends, so the lock is the only place to see it.

**`-v`** passes `-v` to the runners, which print to the task's logs, identically
on every runtime, how each input was read — opened lazily, and what reading it
came to, or decoded whole, and the resident memory that added — and a timing
and peak-memory block. It never changes hashes or caching (add `--force` to see
it for a cached task), and works against a server.
**Where a task's time goes.** `EAST_PROFILE=1` in the environment of a local
`e3 dataflow run` (or `run`, `call`, `mutate`) has the east-c and east-py
runners profile each unit — the runners inherit e3's environment — and the
task's log (`e3 task logs`) then ends with every East function and platform
function it called, by self time, with its calls and where it was written and
called: the python lines of a function `East.importFunction` linked in
included. Each input read lazily is an entry too, named as `-v` names it
(`input 1`): the time its reads spent decoding segments, a call each — keyed
reads at random beyond the segments the runner keeps, or a scan repeated,
which `-v`'s account counts — and not the reading function's own time.
`EAST_PROFILE_INTERVAL=300` adds the profile so far every five minutes while a
long task runs. east-node does not profile. Like `-v` it changes no hash: add
`--force` for a cached task.
**`E3_SCRATCH_DIR`** moves a local run's per-execution scratch directories
(default `<repo>/tmp/scratch`, on the object store's disk; on tmpfs, outputs sit
in memory until stored).

**`repo gc`** keeps each workspace's last 10 runs (`--keep-runs`), every run
from the last 7 days (`--keep-days`) and the run its current state came from,
with every execution those runs used; every execution a workspace's current
state is served from, so a re-run stays cached; every execution from the last 7
days; and whatever is still running. An attempt recorded running that the local
runner says cannot finish is recorded interrupted, and goes as any that ended.
It then removes the objects nothing names, and staging files older than
`--min-age` (60 s). `--dry-run` reports what would go.

A package zip names the release of e3 that exported it, and an import refuses a
zip a newer release exported, naming that release: import it with an e3 at least
as new as the SDK that exported it. A dataset upload names the transfer protocol
its e3 speaks, and a server refuses one that speaks another, naming both
releases and which of them to upgrade.
