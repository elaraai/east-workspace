# @elaraai/e3-rack

Delegate eligible task bodies from a local e3 repository to a rack agent, and
the CLI's ad-hoc runs and function calls. The local process still plans the
graph, checks caches and owns the repository. One hub per operating-system
user coordinates the rack fleet across projects.

## Connect a rack

A rack reaches this machine's hub over HTTPS. The hub serves its rack listener
with its own certificate, made the first time the listener serves TLS, and every
rack pins that certificate by its SHA-256 fingerprint. No certificate authority
or DNS name is involved, so the rack can reach the hub through any relay, and a
relay or tunnel in between forwards bytes it cannot read.

The usual path is an SSH reverse tunnel. The hub listens on the loopback only;
this machine keeps a tunnel open to a relay that the rack can reach, for
example `ssh -N -R 7401:127.0.0.1:7331 relay`, and nothing connects into this
machine directly:

```sh
e3 rack enroll --listen 127.0.0.1:7331 --allow 127.0.0.1 \
  --advertise-url https://relay.example:7401 --label workshop
```

On a private network the rack can connect to the hub directly instead:

```sh
e3 rack enroll --listen 10.0.0.5:7331 --label workshop
```

This starts the hub and prints the **source origin**, the hub's **certificate
SHA-256**, the matching e3-rack release and a short-lived single-use enrollment
token. The source origin is how the rack reaches this machine: the
`--advertise-url`, or the listener's own address when none is set. It is not a
repository URL or the rack server's address; `localhost` on the rack would point
back at the worker itself. Keep the hub and any tunnel available while work runs.

`--advertise-url` names the origin racks reach the hub at: a relay's, a
tunnel's or a TLS terminator's. The hub builds every rack and data URL on it.
Without it, data URLs use the origin each rack request named, which is right
only when the rack connects to the listener directly. A listener on every
address (`0.0.0.0` or `::`) has no address to hand out, so enrollment needs
`--advertise-url` there.

The certificate is kept in the hub's private state (`hub-tls.beast2`, beside
its other state) until it is removed. With the hub stopped, removing that file
makes a new certificate on the next start, which every worker must then pin again.

Plain HTTP (`--no-tls`) is for a TLS terminator in front of the hub, as in
`e3 rack config --no-tls --listen 127.0.0.1:7331 --allow 127.0.0.1 --advertise-url https://terminator.example`.
The hub refuses a plain-HTTP listener on a wildcard or public address, or
without `--allow`: anything on the path of plain HTTP reads every rack token,
data URL, input, output and log. A VPN whose hub decrypts and re-encrypts
traffic is not encrypted end to end. `--allow <ip,...>` admits only the named
addresses (through a local tunnel or terminator, `127.0.0.1`); it does not
encrypt anything.

Use the matching, verified companion release from e3-cloud **inside an already
prepared worker VM**, at the release `e3 rack enroll` printed. Replace the public
allocation path below with the one the host provisioner supplies; do not write
allocation JSON yourself:

```sh
sudo /opt/e3-rack/releases/<release>/e3-rack configure \
  --allocation '/var/lib/e3-rack/<agent-uuid>/allocation.json'
sudo /opt/e3-rack/releases/<release>/e3-rack enroll \
  --allocation '/var/lib/e3-rack/<agent-uuid>/allocation.json'
```

`configure` asks for the source origin and, for an HTTPS origin, the
certificate SHA-256 the hub printed (none for a publicly trusted certificate,
such as a cloud deployment's), then the worker label (`workshop` here), runtime
settings and optional private-registry access. `enroll` asks for the one-time
token. Both use hidden terminal prompts. The worker stores origins, pins,
identities, settings and registry credentials together in encrypted storage; no
token or source address is included in the printed shell commands. The
enrollment token is intentionally displayed by this local minting command: do
not copy its output into logs or a plaintext file.

A plain-HTTP source origin needs `--allow-vpn-http` on both worker commands, and
the worker's host must authorize that exact destination. Use it only on a path
encrypted end to end, such as an SSH tunnel.

The local command waits for a **new registration**, including one with no boot,
tiers or capacity yet; `--no-wait` returns after printing the handoff. A label
filters the observed registrations, so compare the result with the worker's
enrollment result. Enrollment does not prove service activation or readiness.
`e3 rack list` shows `enrolled-not-started` before a first heartbeat.

Once the worker has been activated and explicitly resumed, its heartbeat
publishes concurrent capacity as free plus occupied slots. Busy workers remain
eligible; fenced, draining or unhealthy workers publish zero capacity and show
`unavailable`. Existing work can still finish during drain. Only heartbeats
refresh readiness: lease polling cannot keep an old capacity report alive.
After 45 seconds without a heartbeat the worker stops counting as available.
Source boot approval, when required, remains a separate gate from worker resume:
`e3 rack config --require-approval` quarantines a rack after each reboot until
`e3 rack approve <rack>` admits the boot it reports; enrollment admits the first.

Independent agents belong to separate worker VMs, each with its own identity,
encrypted configuration and host-enforced resource allocation. Whole GPUs are
assigned through the host lifecycle, independently of this enrollment command.
One worker can connect to up to 32 mutually trusted e3 sources. To add another,
first drain the worker and stop its services and socket activation. Inside it:

```sh
sudo /opt/e3-rack/releases/<release>/e3-rack configure \
  --allocation '/var/lib/e3-rack/<agent-uuid>/allocation.json' --add-source
sudo /opt/e3-rack/releases/<release>/e3-rack enroll \
  --allocation '/var/lib/e3-rack/<agent-uuid>/allocation.json' --source '<new-source-uuid>'
```

`configure --add-source` asks you to confirm that these sources may share the
agent's trust boundary, then privately asks for the new origin. It prints the
source UUID for `enroll`. Obtain that source's token with `e3 rack enroll` on
the additional local e3 machine, or from the chosen cloud deployment. Omit the
HTTP opt-in for HTTPS. The host must approve the additional endpoint. Existing
identities and registry access are preserved, every source must be enrolled
before startup, and the next boot remains fenced.

Connections have separate clients, credentials, caches and completion journals.
One worker-wide task/GPU limit bounds actual execution across them; per-source
capacity reports must not be added together as physical reservations. All
connections share the worker's lifecycle. They also share its process and
credential trust boundary: a worker is the trust boundary. Put sources on one
worker only when they trust each other, such as one team's developer hubs.
Each client environment needs a worker of its own, and a cloud deployment and
developer hubs belong on separate workers. Independent agents have no shared
e3 task scheduler.

The hub keeps no task data: leases and data URLs live in its memory, and every
object passes through it from the repository's session. What a worker keeps is
the worker's own policy. The hub checks each object a rack reads against its
lease's closure only, so an agent that fetches every object again for each task
and keeps nothing once the task ends works with it unchanged.

The companion now provides `e3-rack source list --allocation <path>` inside the
worker. It lists source UUIDs and enrollment state; `--show-origins` displays
origins only on a terminal. To disconnect or re-enroll, drain and stop the worker,
revoke the selected rack at its source, then use `source remove` or `source reset`
with `--allocation <path> --source <UUID> --acknowledge-revocation`. Confirm the
UUID at the hidden prompt. Reset prints a **new** UUID. Use it with `enroll
--source`, supplying a fresh token obtained from the e3 source. Reset preserves
the origin and keeps old caches/pending results out of the new identity.
The flag acknowledges prior revocation; it does
not revoke remotely. Other sources and retained data are preserved. Reconcile
host endpoint policy before activation; the next boot remains fenced.

Private registry access has its own worker-local commands:

```sh
sudo /opt/e3-rack/releases/<release>/e3-rack registry status \
  --allocation '/var/lib/e3-rack/<agent-uuid>/allocation.json'
# After a verified drain and stopping the worker services/sockets:
sudo /opt/e3-rack/releases/<release>/e3-rack registry configure \
  --allocation '/var/lib/e3-rack/<agent-uuid>/allocation.json'
```

Status can run while active and shows only whether credentials are stored; it
does not test GHCR access. Configure privately prompts for username/read-only
token without re-entering worker settings. Use `registry clear --allocation
<path>` to remove stored access, confirming the installation UUID privately.
Changes require the same release, the writer lock and no unresolved enrollment
or service transition. They preserve current source identities/rotations, settings,
journals and cached images/task data. Credentials stay in the encrypted bundle;
no Docker login file is created. A later service activation receives the change,
with the next boot still fenced. Neither replacing nor clearing revokes a token
remotely. After interruption, repeat configure with the intended values or clear
to ensure absence; repeating the current values or an absent clear makes no write.

The companion also provides worker-local `reconcile-services`: after a completed
drain and stopped services, it applies the host's next allocation generation and
resource limits. The previous service-plan hash and exact drain/operation/boot
binding protect the transition. Interrupted updates keep activation guarded and
retry with the same operation; ciphertext and journals remain unchanged. This
supports prepared GPU/VFIO assignments at the same executable release; the host
still performs and verifies the physical move, and network quarantine remains.

For a compatible upgrade or downgrade, the target verified executable's
`switch-release` uses another completed drain, the previous plan hash and a new
allocation generation, with unchanged resource/device budgets. Both binaries
must report the same managed-state contract. It changes the runtime version in
the **current** encrypted configuration, preserving all identities, registry
access and journals. Interrupted commits stay guarded and retry with the same
operation; downgrades never restore saved credentials or state. Keep both
four-file releases available through receipt recovery. Services stay stopped
and quarantined until separately activated and resumed.

If the selected release never resumed, its exact recorded predecessor's
`recover-release` uses the completed release receipt, current plan hash and a
new operation at another generation increase. It requires either the original
drained journal or a valid fenced journal with no operation at the failed
generation, and verifies both releases against the recorded fingerprints. Any
resume attempt, including one from a prior boot, prevents this recovery. Current
credentials and journals are preserved; services remain stopped and quarantined.
A release that resumed needs a fresh drain and normal `switch-release`; general
journal repair and recovery after an undrainable resumed release remain open.

The named host manager, source aliases, incompatible-state migrations,
service/network activation and hardware acceptance remain
[cloud #253](https://github.com/elaraai/e3-cloud/issues/253) work. Enrollment alone
is not an end-to-end deployment. See the companion's
[worker configuration and service contract](https://github.com/elaraai/e3-cloud/blob/72c5c629e1708421171d3c86b8d7cb470f46802e/packages/e3-rack-agent/credentials/README.md).

## Select work

```sh
e3 rack policy . set 'train_*' rack --size large
e3 dataflow run . dev --rack
e3 watch src/main.ts . dev --start --rack
```

Policies live in `<repo>/rack/policy.beast2`. Rules match the entire task name
with `*` and `?`; the first matching rule wins. By default, unmatched tasks
stay local. Rules and placement do not change task or cache hashes.

A rule's `--size` is a shorthand for cores and memory (`RACK_SIZES`):

| Size | Cores | Memory |
| --- | --- | --- |
| `serverless` | 2 | 2 GiB |
| `small` | 2 | 4 GiB |
| `medium` | 4 | 8 GiB |
| `large` | 8 | 16 GiB |
| `xlarge` | 16 | 32 GiB |

`--memory-limit 8G` is a ceiling on what one piece of the rule's work may be
capped at on a rack, read as `--memory` is. It is no request: e3 measures what
a piece needs. `--gpu` asks for a rack's GPU. `--merges local` runs the merge
and combine units of a split task the rule sends to a rack here, beside its
planning, while its pieces run on the rack: each piece's output is here
already, so such a merge fetches nothing over the link, and runs under the
run's local budget (`--merges rack`, the default, leases it as its pieces are).
`defaults --merges local` sets it for every rule that names none. Setting a
rule again replaces it whole. A policy an earlier release stored is carried
into this release's form when its repository is next opened, every rule as it
was and its merges on a rack.

```sh
e3 rack policy . show
e3 rack policy . enable                  # opt in without a flag on each run
e3 rack policy . mode auto               # route eligible unmatched tasks too
e3 rack policy . set 'ingest_*' local
e3 rack policy . set 'score_*' rack --memory-limit 8G
e3 rack policy . set 'embed_*' rack --size xlarge --gpu
e3 rack policy . set 'rollup_*' rack --merges local   # pieces on a rack, merges here
e3 rack policy . defaults --no-spill --claim-timeout 30
e3 rack policy . defaults --no-weigh-fetch # place by the rules alone
e3 dataflow run . dev --no-rack           # override the saved opt-in
e3 dataflow run . dev --rack-only         # wait when compatible racks are busy
e3 rack policy . unset 'train_*'
e3 rack policy . reset
```

Defaults are disabled, opt-in selection, `large`, a 1440-minute timeout,
capacity spill enabled, a 30-second claim recheck, no local retry of task
failures, fetch-bound work run here ([below](#work-that-would-fetch-longer-than-it-runs)),
and a split task's merges on a rack with its pieces. `--rack-only` disables
capacity spill and the weighing of fetches; infrastructure failures can still
fall back locally, after a wait: work whose racks are not healthy waits
two minutes for one to come back, and work whose transfer failed its tries is
leased once more. It does not force ineligible tasks onto a rack, nor a split
task's merges its policy keeps here (`--merges local`).
Rack flags apply to local dataflows, watch with `--start`, and `e3 run` and
`e3 call` ([below](#one-task-or-one-call)), and are refused for remote
repository URLs. A local API server's calls, mutations and intake remain local.

Stock runner configurations delegate, and so does a task that declares a
`python` or `node` environment, with the project platform packages its runner
names: see [Tasks that declare an environment](#tasks-that-declare-an-environment).
Custom commands, a platform package named by a task that declares no
environment, and unscannable programs stay local. Programs that access
host files, environment variables or network resources also stay local by
default: their dependencies may exist only on this machine. A task rule's
`--allow-host-access` deliberately overrides that guard, for a rack that
provides those resources itself. The companion agent's task VMs have no network
device, host files or injected environment, so such a task fails there.

### Work that would fetch longer than it runs

A rack reads every object of a unit's closure it does not hold across the
link to it. Before a task or a unit of a split task is leased, the launching
machine weighs that: the bytes of its closure the rack is not known to hold,
at the link's rate, against how long the work ran when e3 last recorded it.
Work that would spend longer fetching than it ran runs here, and says so:

```text
  [LOCAL] scan_rows (fetch-bound: 903 MB ≈ 90 s to fetch, ran 19 s)
```

- **The link's rate** is the hub's to measure: every byte a rack reads
  streams through it, so it counts what it sends each rack while any of the
  rack's transfers is in flight, a sample each 16 MiB, smoothed as a moving
  average. A rate no transfer has refreshed for thirty minutes is forgotten.
  A rack whose link is not measured yet is taken to carry a gigabit (`at an
  assumed 1 Gbit/s` on the line), so a first run keeps on the rack all but
  what would be fetch-bound even over a LAN, and its transfers measure the
  link.
- **What a rack holds** is each object the hub served it whole, by
  repository, since the hub started: what the next unit over the same
  collection does not fetch again. An output a rack wrote is not counted.
- **How long the work ran** is its execution records': the latest success of
  the same inputs, else the task's latest success, and for a unit the median
  of its task's units. Work that has not succeeded before follows its policy.
  A record of work that ran on a rack counts its time there, its fetch among
  it; work the same e3 process saw run on a rack (a run's earlier units, a
  watch's earlier runs) is taken at its rack's `ran` phase instead, from its
  runner's start to its end.
- Each rack that could take the work is weighed, and the work runs here only
  if every one of them would fetch it for longer than it ran. A hub that does
  not answer weighs nothing.

`--rack-only` keeps its work for the rack whatever it would fetch, as it does
whatever the local machine has free. `e3 rack policy . defaults
--no-weigh-fetch` places by the rules alone. A watch's runs share the hub,
and so what it measured and what its racks hold. The weighing reads records
and writes none: placement never changes a task's hash or its cache. A
function call is not weighed: e3 records no run time of one. Nor is a merge
its policy keeps here (`--merges local`): it runs here before any weighing,
and fetches nothing; a merge on a rack (`--merges rack`) is weighed as any
unit is, by the median of its task's units.

### Tasks that declare an environment

A task whose models are the project's own platform functions declares an
environment (`environment: { python: { project } }`, or one e3 derives from a
`{ custom: '<package>' }` platform), and nothing changes in the package for a
rack. It runs on a rack whose agent composes environments, which `e3 rack
list` shows among the rack's features and a run says on its first line:

```sh
e3 rack policy . set 'train_*' rack --gpu      # this task wants the rack's GPU
e3 dataflow run . dev --rack
```

```text
Rack: workshop (56 cores, 262 GB, 1 GPU, e3 1.0.108, environments for x86_64-manylinux_2_28)
  [ENV] 3f9a2b1c0d4e for x86_64-manylinux_2_28: building
  [ENV] 3f9a2b1c0d4e built in 48 s: 4 layers, 2.1 GB (1 new)
  [RACK] train_model → workshop (cap 16 GB)
  [LOCAL] convert_report (environment:tools)
  [LOCAL] fit_curves (environment:native-package:fastfit)
```

Before it leases such a task, this machine installs the environment a second
time, for the rack's platform, with the same frozen installs a local run uses
(`uv sync --frozen`, `npm ci`), and packs it as layers that the rack fetches
through the hub as it fetches task data. **No container runtime is needed, on
this machine or the rack**, and the rack needs no route to a package index.
Nothing is compiled for the rack: its dependencies are wheels, and a python
environment carries its own interpreter, its own runner and its own packages,
the GPU ones included. A second run builds nothing. After a change to the
project's code only the small layer that holds it is new: the interpreter and
the third-party packages are the same bytes, and the rack already has them.
The layers are kept under the repository's `rack/env-layers`, and `e3 repo gc`
removes those of an environment nothing uses any more.

A rack whose agent composes environments **over its tier** needs far less of a
python environment. Its tier's image already holds an interpreter, Python
3.12, and, for the datascience tier, torch and its CUDA libraries, and its
agent reports what the image holds. This machine then builds the environment over that image: without
an interpreter, and without each distribution the image holds the same, by its
name, its version and the files it installed. It says so as it builds:

```text
  [ENV] 3f9a2b1c0d4e for x86_64-manylinux_2_28 over py-datascience: building
  [ENV] 3f9a2b1c0d4e built in 41 s: 2 layers, 6.2 MB (2 new), 31 distributions from the tier
```

A node environment is built over the `node` tier's image the same way. That
image holds East's node packages, installed globally (`@elaraai/east`,
`east-node-std`, `east-node-io`, `east-node-cli`, `east-ui`), and this machine
builds the environment without each of them that its lock resolved from the
registry at the version the image holds, and without each package only they
need: what `east-node-io` alone brings is most of a node environment's bytes.
The rack links each one left out to the image's copy, which finds what it
needs where it is, so the project's code and the runner load one copy of
East. What the project's own packages need ships, at the versions its lock
chose:

```text
  [ENV] 8c41e07a9b2d for x86_64-manylinux_2_28 over node: building
  [ENV] 8c41e07a9b2d built in 9 s: 2 layers, 1.4 MB (2 new), 187 packages from the tier
```

| The rack, the environment | What is built |
| --- | --- |
| The rack reports `environments-over-tier` and its tier's image; a python environment whose lock takes the image's Python | Over that image: what the image lacks, and the project's own code. |
| The rack reports `environments-over-tier` and its node tier's image; a node environment npm locked | Over that image: the project's own code and what it needs, without East's packages the image holds and what only they need. |
| The rack reports `environments` alone | Whole, as above. |
| The environment pins another version of something the image holds | Its own ships, and is found first. |
| A node environment's lock takes an East package from another registry, a path or a repository, or at another version than the image's | That package ships, as the project's own. |
| The lock's `requires-python` leaves out the image's Python; a node environment pnpm locked | Whole. |
| The rack's tier image changes | Built again over the new image, which is quick. |

Every distribution is still downloaded here once, into uv's cache: that is
how one is told to be the image's. It is neither packed nor sent. A node
environment is installed whole here too, before what is left to the image is
removed from it.

**For torch to stay in the tier, ask for it through the datascience package's
extras.** A member that lists `elaraai-east-py-datascience[torch,lightning]`,
and no torch of its own, locks the torch from PyPI that its release was tested
with, which that release's `py-datascience` image holds; and its task runs over
that image, whatever platforms its runner names, since its environment
installs the datascience platform. A member that lists `torch` itself runs
over that image too, but locks the newest, and is sent it, unless the
release's pins below hold it at the image's. One that takes torch from a
PyTorch index is sent it too: its `+cpu` or `+cu130` build meets the extras'
pin, since a pin with no local label is met by every local label, and is not
the image's.
What nothing pins is still sent when it has moved since the release: numpy and
other small packages. A project `npm create @elaraai/e3` scaffolds holds those
to the tier already: its root `pyproject.toml` carries the release's pins,
which `--update` moves to a later release's. Any other project holds them with
the pins of the release's `east-py-constraints.txt` (in `@elaraai/e3-core`'s `tier/`), under
`[tool.uv] constraint-dependencies` in its workspace root, each written
`name==version ; marker`: the pin and its marker, and none of the line's
trailing `\`, `--hash` lines or `# via` notes. Every pin of a name goes in,
each with its marker, or one platform is held at another's version; the
datascience package's README shows the form.

A task whose environment cannot go to a rack runs here, and says why on its
`[LOCAL]` line; a build's own message is in the task's log (`e3 task logs`).

| The task | Reason | Why |
| --- | --- | --- |
| Declares a `tools` or an `image` environment | `environment:tools`, `environment:image` | A `tools` environment is files of this machine's platform; an `image` is a server's. |
| This machine is Windows | `environment:windows-host` | An environment built there has another layout than a Linux guest's. |
| No healthy rack of its tier composes environments | `no-rack-for-environment:<tier>` | Its agent is from before environments, or reports no platform. |
| A dependency has no wheel for the rack's platform | `environment:no-wheel:<package>` | Nothing is compiled for another platform. |
| A project package compiles native code | `environment:native-package:<package>` | The same. |
| A `node` environment with a pnpm lock, on a pnpm that installs for its own platform alone | `environment:pnpm` | pnpm takes a platform's flags from version 11; built anyway when this machine is of the rack's platform. |
| The build fails | `environment:build-failed` | The tool's own message is in the task's log. |
| Names a platform package and declares no environment | `non-stock-platform:<name>` | A rack has nowhere to find the package. |
| Its rule says `--gpu` and it is not an `east-py` task | `gpu-not-east-py` | The GPU tier is python's. |

A task's tier is its runner's. An `east-py` task runs on `py-datascience` when
it names `east-py-datascience`, when the environment it declares installs that
platform or torch (`elaraai-east-py-datascience`, `torch`, read from its lock
as its sync installs them), or when its rule says `--gpu`, and on `py`
otherwise. Only `--gpu` asks for the rack's GPU. Work no rack of its tier
takes runs here, at once, or under `--rack-only` once two minutes have passed
with none, and its `[LOCAL]` line says why (`no-rack-for-tier:py-datascience`
where no rack serves the tier). It never falls back to `py`, which would send
torch with its environment.

### One task or one call

`e3 run` and `e3 call` take `--rack` and `--rack-only` for the one piece of
work they name. The flag selects it, whatever the policy's rules or its
`enable` say, and a rule that matches its name still sizes it: a call is named
`fn:<name>`, and one from an IR file by the file's name without its extension.
Fitness applies as it does to a task, and every reason the work runs here is
printed:

```sh
e3 run . acme-forecast.train ./sales.beast2 -o ./model.beast2 --rack
e3 call . -w dev train_once @.inputs.sales --rack
e3 call . --ir ./score.beast2 '[1.0, 2.0]' 5 --rack
e3 rack policy . set 'fn:train_once' rack --size xlarge
```

```text
Running acme-forecast@1.2.0/train
  Input: ./sales.beast2 -> 3f9a2b1c0d4e...
  [RACK] train → workshop (cap 16 GB)
Rack summary: 1 task on workshop · 0 waited for capacity · 0 ran again · 0 transfers retried · 0 ran locally
Done (41250ms)
Output: ./model.beast2
```

`e3 run --rack` runs the task as a dataflow runs it: a whole task's body on a
rack, or a split task's pieces and merges, its planning and assembly here; its
cache and history are a local run's. A call's lines go to the terminal's
stderr, its value to stdout: `[RACK] fn:train_once → workshop (cap 32 GB)`, or
`[LOCAL] fn:read_config (host-coupled:fs_read_file)`.

A call is a lease of its own, never joined to another's, sized as a whole task
is, its program and any argument past 192 KiB staged as objects with its
closure. Its value comes back with its completion, or past 192 KiB as the
object the completion commits. Its time is the one its caller's spec gives it,
counted from when its lease is first queued, and may be longer than the 24.8
days one timer waits. The CLI gives a call its rule's timeout when a rule that
matches `fn:<name>` sets one (`rackCallTimeoutMs`), longer or shorter than its
own ten minutes, and else those ten minutes; the call's drafts and its function
share that time. A call no rack may run is judged before any session opens,
and runs here at once, starting no hub.
Ctrl-C leaves the lease of a call, and the leases of an ad-hoc run, whose
output file is then left as it was. A call or a run that had finished as
Ctrl-C came answers as it would have: nothing was stopped. An ad-hoc run the
cache answers is no rack's work, and opens no rack session.

| The call | What it comes to |
| --- | --- |
| Not fit for a rack, or no healthy rack of its tier | Runs here; its line says why. |
| No rack claims it within the claim timeout | Runs here; under `--rack-only`, waits while a compatible rack is healthy. |
| Success | The value. |
| `too_large`, `timed_out` | Its answer, as a local call's would be. |
| The function fails | Its answer, with its exit code and log tails; run again here only with `--retry-task-failures-locally`. |
| Its cap stops it | Fails, `memory-limit-exceeded`, naming the cap. |
| The rack cannot relay its value | Runs here (`value-too-large-to-relay`). |
| The hub or the lease is lost, or the rack's infrastructure fails | Runs here, with the time left. |
| Ctrl-C | The lease is left and its rack told to stop it. |

## Execution and recovery

Current sources include optional first-claim queue timings in grant response
headers. The companion agent records admission, input/image preparation, VM and
guest startup milestones on its own monotonic clock. Its
[latency benchmark and p50/p95 report](https://github.com/elaraai/e3-cloud/blob/998d879ac6c199e7f300bf9b9531293b4e8f5dc0/scripts/rack/LATENCY.md)
separate cached CPU, GPU and first-use observations, including failures and
missing data. Guest execution entry precedes runtime imports and CUDA startup;
source queue time is separate and cannot be added as exact end-to-end latency.
This adds no persisted or BEAST2 wire field and requires no new credentials.

After a cache miss, the local planner offers an eligible task or split-task
unit to the hub. A compatible healthy agent claims it, downloads the task and
its complete input object graph, executes in a VM, and streams logs. It uploads
each output object by hash and size, then commits its upload receipt. The local
session verifies the complete output graph before recording success. Planning,
splitting and merging decisions remain local; map and merge bodies can both
run remotely, including when the map outputs were already cached.

Local work and fallback share the run's existing `-j` and `--memory` budget.
Remote bodies consume rack slots without reserving a local runner slot. Local
orchestrator width includes compatible rack capacity.

Concurrent sessions of the same canonical repository and e3 release can share
one lease. Cancelling one subscriber leaves the others running; cancelling
the last stops the lease. An interrupted remote attempt and its local retry
have distinct execution records. The task's timeout and the run's own
cancellation are not retried locally; an attempt the rack stopped on its own
is. Task failures are returned unless the policy explicitly enables
`--retry-task-failures-locally`; infrastructure failures fall back locally.

### What a run prints

A lease's result says why it ended as it did: a `reason` with a code a program
reads, and what the code carries. A run prints each on its line and sums its
rack work up as it ends:

```text
Rack: workshop (56 cores, 262 GB, 1 GPU, e3 1.0.108)
  [RACK] train_model → workshop (cap 16 GB)
  [RACK] train_model input transfer retried (2 of 5): connection reset
  [RACK] embed_rows waiting: needs 8 cores and 16 GB, workshop has 12 cores and 9 GB free
  [RACK] score_rows outgrew its 3 GB cap on workshop: runs again under 4.5 GB
  [RACK] score_rows stopped on workshop at 2.6 GB, its host short of memory: runs again reserving 2.6 GB
  [LOCAL] score_rows (input-transfer-failed: connection reset)
Rack summary: 1 task and 12 units on workshop · 1 waited for capacity (longest 38 s) · 1 ran again · 1 transfer retried · 1 ran locally
```

| `reason.code` | Carries | Who sets it | The work |
| --- | --- | --- | --- |
| `input-transfer-failed`, `output-transfer-failed` | `attempts`, `cause` | The rack, after its five tries. | Runs locally; under `--rack-only`, is leased once more first. |
| `guest-crashed` | `detail` | The rack, when the guest ended without an outcome once it had its lease. | Runs locally: a rack's fault never fails a run. |
| `guest-boot-failed`, `tier-image-failed`, `work-disk-full`, `no-room`, `rack-stopping`, `rack-failed` | `detail` | The rack: its VM did not boot; it could not make the tier's image; the work filled its disk; it had no room once the grant settled; it or its host is stopping; a cause of its own no other word names. | Runs locally. |
| `environment-failed` | `detail` | The rack, when it could not compose the lease's environment from its layers. | Runs locally. |
| `source-unreachable` | `ms` | The rack, whose source has not answered for two minutes; the launching machine, when the racks that run the work's tier are enrolled but not healthy. | Runs locally: at once, or under `--rack-only` once two minutes have passed with none healthy. |
| `task-error` | | The rack: the task's own failure. | Its failure is its verdict, unless the policy retries failures locally. |
| `outgrew-cap` | `capBytes`, `peakBytes` | The rack, when the cap stopped the work. | A unit of a split task is leased again under a cap half as large again, and its stopped attempt is no failure in the task's history. A whole task fails, `memory-limit-exceeded (cap 16 GB); raise --memory-limit or --size`, and is not run again unless the policy retries failures locally. |
| `memory-limit-exceeded` | `needsBytes`, `limitBytes` | The launching machine. | A unit whose cap would pass its rule's `--memory-limit`, or every rack's memory, runs locally, under the local budget. |
| `fetch-bound` (a placement's `fetch`) | `bytes`, `fetchMs`, `ranMs`, `measured` | The launching machine, before any lease. | A task or a unit whose closure would take longer to fetch than it last ran runs locally ([above](#work-that-would-fetch-longer-than-it-runs)). |
| `requeued-pressure` | `peakBytes` | A rack that books what its leases reserve, when its host ran short of memory and it stopped the newest work it held. | A unit of a split task is leased again reserving what it reached, at least what it reserved; the dataflow raises `requeued` with reason `budget`, as for a unit a local run's guard stopped, and its stopped attempt is no failure in the task's history. A whole task reserves its cap, so a rack has no cause to stop it for this; one it does runs locally. |

A result also lists the tries of its transfers that failed and were followed
by another (`retries`), which the run prints when the lease ends. A code a
build does not know is a rack's fault it cannot name, and the work runs
locally. `e3 rack status` lists how the hub's last twenty leases ended, each
with its reason. In code, `RackPlacementEvent` carries the same (`kind`
`placed`, `waiting`, `retried`, `outgrew` or `stopped`, and a local
placement's `detail`, or its `fetch`), and
`rack.takeSummary()` with `describeRackSummary` the line.

A rack's agent may also say where the lease's time went (`phases`: each mark
it reached, in ms after it received the grant, by its own clock, and the bytes
it fetched from its source, read from its cache and sent; read with
`readRackPhases`). A run prints them, after the duration, on the line of the
work they are of: `[DONE]` for a task, and `[PART]`, `[MERGE]` or `[COMBINE]`
for a unit of a split task, as `describeRackPhases` says them:

```text
  [PART] score_rows 3/48 #3 [271204ms] — granted +12 s · fetched 903 MB (0 B cached) 260 s · booted 3 s · ran 19 s · sent 4 MB 1 s
```

`granted` is how long the work waited for a rack to claim it, by this machine's
clock; `admitted` (shown when half a second or more) how long its rack took to
have room for it; `fetched` the bytes its source sent the rack, those its guest
read from the rack's cache, and how long a fetch was under way, which overlaps
the run, since a guest fetches its inputs as its work reads them; `booted`
from its admission until its guest asked for its lease; `ran` its execution;
`sent` the bytes it sent its source, and how long after its result the last
object was in the store. The same is the last line of the work's log (`e3: on
its rack: …`, which `e3 task logs` shows), and follows each unit's line in its
split task's log. A rack whose agent says none prints nothing more, and a hub
or source that knows none ignores them: they are JSON in the result, read by
name, as its reason is.

A rack that admits work by its resources reports all it has and what is free,
and the hub's fleet snapshot carries both for each such rack: what is free is
the less of what the rack last reported and what the hub's own leases leave of
all it has. The launching machine reads the snapshot for three things. The
racks are **full** when no compatible rack's free resources hold what the
lease reserves, less the work already queued: with spill on and a free local core the work
then runs locally (`spill`), and otherwise it is queued and the run says once
that it waits. Work **no rack could ever hold**, with nothing else on it, is
not queued: it runs locally (`memory-limit-exceeded: needs 32 GB, limit 16
GB`, or `no-rack-holds:gpu`). A rack holds work only when all its memory holds
the work's cap, whatever it reserves, since the work may grow to its cap
there. And a run is as much **wider** as the compatible
racks have cores (`rackSlots`), so a split task's pieces are queued together.
`e3 rack list` shows each rack's resources and features:

```text
LABEL  ID  RUNTIMES  BUSY/CAPACITY  AGENT  E3  LAST SEEN  RESOURCES  FEATURES  STATE
workshop  01a1da04-228  node,py  3/56  0.6.0+e3.1.0.108  1.0.108  2026-11-14T12:24:26.505  56 cores (41 free), 262 GB (120 GB free), 1 GPU (0 free)  resources  ready
```

A rack that reports no resources admits by its slots, as before: its row
shows `-`, and its work is counted in slots. It caps nothing, so it is leased
whole tasks alone: a split task's units go to a rack that admits by its
resources, or run here, counted in the run's summary as having run locally
(a placement's reason is then `no-rack-caps-units:<tier>`). The hub grants by
the same rule, so beside a rack that caps units one that does not is never
handed one. A run says so of such a rack before it starts, on the line that
lists its racks (`workshop (4 slots, whole tasks only, e3 1.0.108)`): with
`--rack-only` too, a split task's units then run on this machine.

A rack says what it has with each heartbeat, every fifteen seconds. A hub that
has just started (after an upgrade, or once it had exited idle) knows its racks
from its registry and has not heard them yet: until it has, such a rack is
leased whole tasks, and no unit and no work that declares an environment. A
run that keeps its work for a rack (`--rack-only`) waits for the rack to say
it; any other runs that work here meanwhile (`source-unreachable`).

### A split task on a rack

A rack that admits by its resources books each unit at what its lease
reserves, lets it grow to its cap, and stops one that outgrows its cap or, when
its host runs short of memory, the newest it holds. That is what a local run's
budget and guard do, so a split task then runs on a rack as it does locally:

- **Every unit of a stage is queued together**, each reserving what the task
  was last measured to need and capped half as much again, as a local unit is,
  so a rack holds as many as a local run of its size would. The run's own budget must be guarded too
  (Linux and macOS), since a unit may yet run locally.
- **A unit its cap stopped runs again** on its next lease, under a cap half as
  large again, as a local unit its cgroup's cap killed does; the dataflow
  raises `requeued` with reason `cap`, and prints its `[REQUEUE]` line.
- **A unit its rack stopped for its host's memory runs again** on its next
  lease, reserving what it reached, at least what it reserved, as a unit a
  local run's guard stopped does; the dataflow raises `requeued` with reason
  `budget`.
- **A task's first run** reserves for each piece e3's estimate (the runner's
  own memory and what the largest piece holds of its rows), as a local run
  does, capped half as much again: so a first run is as wide as a later one,
  and no piece runs first to measure the rest. A piece the estimate is low for
  outgrows its cap and runs again under a larger one. Only a piece that
  expects nothing at all books its rule's `--memory-limit`, else its size's
  memory.

So a rack is filled as a local run fills its machine, and its guard, not the
sum of its caps, keeps e3 work from running its host out of memory.

#### What a rack keeps of a split task

Every output a rack makes comes here, whole, before its unit succeeds: this
machine's cache of each unit, a resumed run's stages, `e3 repo gc` and a unit
that runs locally all read it here. Without more, a merge then fetches every
piece it merges back from here, over the same link. So each unit's lease
names the split task's **execution** it runs in, its scope: a random id, one
for each execution, and whether a later unit reads what this one writes (a
piece of a set, a dict or a fold does; an array's pieces, which are
concatenated here, and the last level of merges do not; nor does a piece of
a task whose merges its policy keeps here, `--merges local`). A rack whose agent
says it keeps them (`split-scopes`) keeps what such a lease wrote, once it is
here, and gives it to the later leases of the same execution that read it,
which then fetch nothing of it; an agent that does not is granted the same
lease without its scope, and fetches as before.

The execution's end ends the scope however it ends: its task succeeds,
fails, is cancelled or yields, or the run's session closes. The hub tells
each rack it granted a lease of the scope with its next heartbeat, and the
rack lets what it kept go; the agent's own bound on how much and how long it
keeps applies besides. A unit of a scope goes first, for five seconds
(`SCOPE_AFFINITY_MS`), to a rack that holds some of the scope, so a merge
runs where its pieces are when that rack has room for it; after that any
rack may take it.

| Pieces | Merge levels | What a merge fetches back without a scope | With one, on the rack that made the pieces |
| --- | --- | --- | --- |
| 7 | 1 | every piece's output, once (P bytes) | nothing |
| 100 | 2 | every piece's output, then every first-level merge's output (about 2P for a dict or set whose keys do not collapse) | nothing |

A unit always runs where something stops it when it outgrows its share: on a
rack that admits by its resources, or here, under the run's own budget and
guard. So a stage starts its units together, as a run without `--rack` does,
whatever racks there are: none, one that turns healthy part-way through the
run, or a rack that admits by its slots, which is leased no unit, alone or
beside one that is. No stage runs one unit first to measure the rest. The
body says this of itself (`stopsUnits`), so a host that gives
`createRackBody` to a `LocalTaskRunner` of its own says nothing for it.

Ctrl-C in `e3 dataflow run` requests cancellation of that run, including its
delegated work. A current companion agent keeps an outbound cancellation
request open while work is active. The source checks the watched leases every
250 ms and answers as soon as one stops; the agent aborts that task and destroys
its VM before waiting for log delivery. Other tasks and sources keep running.
The normal health heartbeat remains 15 seconds. Against an older source without
this endpoint, the new agent uses a one-second heartbeat while busy.

The companion also cancels input/layer downloads, output uploads, storage requests
and upload retry waits. It stops parallel transfers and waits for their cleanup
before deleting staging or releasing the invocation slot. A finished guest's VM
is destroyed before waiting for output delivery. Each object/layer HTTP attempt
has a 120-second deadline, including its body; cancellation interrupts it immediately.
Cancellation also reaches first-use image builds, environment composition,
scratch-disk preparation and VM startup. A shared image build continues for its
remaining leases; the last cancelled waiter stops it and waits for cleanup.
Cancelled boots retain GPU ownership until process exit is confirmed, and
uncertain teardown requires recovery. Filesystem operations and final publication
already in progress still finish safely before cleanup; a process stuck in kernel I/O can
delay that. See the [companion cancellation boundaries](https://github.com/elaraai/e3-cloud/blob/72c5c629e1708421171d3c86b8d7cb470f46802e/packages/e3-rack-agent/README.md#cancelling-delegated-work).

This targets cancellation delivery within about a second on a healthy connection;
network failures and VM/GPU teardown can take longer. The CLI's cancellation
message is not confirmation that the remote VM has exited. Killing the CLI
without allowing its signal handler to run relies on lost-session cleanup.

```sh
e3 rack status                         # does not start an absent hub
e3 rack list
e3 task logs . dev.train_model --follow
e3 rack remove workshop                # revoke this rack's credential
e3 rack config --require-approval      # quarantine each reboot until approved
e3 rack approve workshop               # admit the boot this rack last reported
e3 rack stop                           # stop the shared hub
```

Hub state lives under `~/.e3/rack` (override with `E3_RACK_HOME`). The rack
listener is off until configured. A running hub and the e3 that calls it speak
the same control protocol (6) exactly. A hub that an older e3 started is asked
to exit once idle, and the run that found it runs locally this time; `e3 rack
stop` with that e3, or ending its process, replaces it now. So every project
that uses a rack from one machine runs the e3 release that machine's hub was
started by: they are upgraded together, and a hub kept running as a service
is stopped and started again with the new e3. Agents must report
a bundled e3 version at least as new as the project's, and speak the hub's rack
protocol ([below](#rack-protocol)): `e3 rack list` shows one that does not as
`incompatible: speaks rack protocol 2, not 3; update the rack`.

A hub that `e3 dataflow run` starts exits after 15 idle minutes, while a run
waits up to 10 seconds for an enrolled rack to report healthy and fixes its
parallelism as it starts; with no rack enrolled, or a policy that selects no
task for a rack, it starts at once. An agent reconnecting after the hub exits
backs off for up to 30 seconds. For a hub racks can always reach, run
`e3 rack hub` as a service, or set `e3 rack config --idle-exit 0`.

A rack reads and writes each object through a data URL that lasts 15 minutes,
and a transfer may take all of it; an object is at most 5 GiB. Every transfer
streams through this machine, so the hub looks after the link:

- It serves one rack **32 transfers at once**, the number its hello states
  (`limits.transfersAtOnce`). One more is answered `429 busy` with how long to
  wait, before any byte of it is read. An agent keeps to the hello's number
  itself, so it is not told to wait. A link of 35 ms and 15 MB/s holds half a
  MB in flight, and a transfer of a segment moves some KiB a round trip: eight
  at once, as before, carried a tenth of what such a link does.
- It serves a **small object inline**, in the storage reply that asked for
  it, rather than a URL to be read in another round trip: up to the size the
  request names in `x-e3-rack-inline-max` (`RACK_INLINE_MAX_HEADER`), at most
  64 KiB (`RACK_INLINE_OBJECT_MAX`), and 4 KiB for a request that names none,
  as before. A reply carries at most 2 MiB inline (`RACK_INLINE_REPLY_BYTES`),
  and the rest of its objects as URLs. Its hello names `inline-objects`
  (`RACK_INLINE_OBJECTS`): an agent names a size only to a source that does,
  and asks such a source for the small objects of a lease's closure, a few
  hundred to a request, as the lease starts.
- A read honours **`Range: bytes=N-`** and answers `206` from that byte, so a
  transfer a slow or broken link cut short goes on from where it stopped. A
  data URL whose 15 minutes ended, or whose transfer its end cut (`404`,
  `410`), is issued again by the next storage request for the same object.
- The listener keeps an **idle connection for 75 seconds** and says so in every
  reply's `Keep-Alive`; an agent closes one it has not used for 60
  (`RACK_LISTENER_IDLE_MS`, `RACK_AGENT_IDLE_MS`), and sooner when a source
  says it keeps one for less. Over a link with any delay, a request sent on a
  connection its source has just closed ends as a connection reset
  (`socket hang up`); `pinnedFetch` and `pinnedHttpsAgent` keep to this.

An agent gives a transfer that fails five tries, each read going on from the
byte the one before reached, before it fails the lease, which then falls back
locally.

## Local API server

Install matching `@elaraai/e3-api-server` and `@elaraai/e3-rack`, then opt in:

```sh
e3-api-server --repos ./repos --rack -j 4 --memory 8G
```

Each API dataflow run gets its own rack session using the server's existing
shared budget. Repository rules still select tasks; explicit server opt-in
overrides the policy's `enabled` default. A programmatic server can use:

```ts
import { createServer } from '@elaraai/e3-api-server';
import { createDataflowRunnerFactory } from '@elaraai/e3-rack';

const server = await createServer({
  reposDir: './repos',
  dataflowRunner: createDataflowRunnerFactory(),
});
await server.start();
```

The server can run without the optional rack package. Its portable handlers
accept a runner factory; they do not import Node-only hub code.

## Compatibility and verification boundaries

If `rack status` reports a listener error, confirm the configured address is
present on this machine and the port is free; a listener the hub refuses to
serve says why. Prefer a stable source origin, such as a relay's address. A
changed source origin needs a deliberate managed source transition;
re-running worker `configure` preserves an enrolled source's origin and identity.
If a rack is incompatible, its executable's bundled e3 must be upgraded along
with its runtime images. Managed `configure` deliberately refuses a release
change: use the companion's guarded `switch-release` workflow above. Releases
without its managed-state compatibility contract are refused. Do not switch its executable symlink or erase its service plan and
journals to bypass this guard. If a task stays local, inspect `rack policy show`,
the task's runner/platforms and host-access dependencies; `--rack-only` cannot
override eligibility.

Public package entries are `@elaraai/e3-rack` (local hub/client/routing/runner
APIs), `@elaraai/e3-rack/protocol` (wire types),
`@elaraai/e3-rack/server` (shared control-plane mechanisms without local hub startup),
`@elaraai/e3-rack/testing` (test agent and contracts), and
`@elaraai/e3-rack/hub-main` (hub process entry point).

Hosts adopt shared routes, dispatch, identity and store interfaces through the
server entry; this avoids importing the local hub's filesystem/runner adapters.
They implement `RackRegistry.compareAndSetRack`:
replace exactly the observed registration, atomically, and refuse a missing or
changed record. `updateRack` retries a patch against the latest value. This
preserves revocation, boot approval and drain state across concurrent requests;
a process-local coordinator alone cannot protect a distributed control plane.
Run `rackRegistryContract` from the testing entry against each backend. The file
registry retains its single-writer hub lock and heartbeat coalescing. This changes
no persisted or wire schema.

The shared routes retain a fixed 250 ms claim cadence by default. Cloud hosts
can set `pollMaxMs` to back off an idle poll (×1.5 per empty check), and
`policyRecheckMs` to reduce idle policy reads. For example, the cloud adapter
uses a one-second maximum and five-second idle policy refresh. Every actual
claim rereads registration and policy, including drain, revocation and boot
approval; cached idle permission cannot authorize work. Cancellation watches
keep their separate 250 ms cadence. Object reads, target signing and environment
layer signing run at most eight operations concurrently. Output declarations
are reserved first, and every started operation settles before the lease fence
is released, including after a failure. Commits stay sequential for distributed
backends whose transactions condition on the same lease row.

### Rack protocol

An agent and its source speak **rack protocol 3** (`RACK_PROTOCOL`, from the
protocol entry). A rack serves sources of several e3 releases at once, so
nothing the two exchange holds a type of e3's HTTP API, whose shapes change
with a release:

- **Hello.** `GET /api/rack/hello` answers anyone who reaches the listener,
  before any credential, in JSON: `{ "protocol": 3, "e3": "<release>",
  "limits": { "transfersAtOnce": 32 }, "features": ["call-value-objects", "tier-manifests", "inline-objects"] }`. An
  agent asks it before it spends an enrollment token. `features` names what the
  source takes beyond the protocol: a source from before it names none, and an
  entry a reader does not know, a word or of another form, is passed over.
- **Requests.** Every request names its protocol in the `x-e3-rack-protocol`
  header and carries the BEAST2 of the route's request type. One that names
  another protocol, or none, is answered `426 upgrade-required` before its body
  is read; an enrollment refused this way does not spend its token.
- **Replies.** A success is status 200 and the BEAST2 of the route's own
  response type, with no envelope; an idle poll for work is 204.
- **Refusals.** A status and JSON: `{ "error": { "code", "message",
  "retryAfterMs"? } }`. The status says whether the same request is worth
  sending again.

| Status | Means (`code`) | An agent |
| --- | --- | --- |
| 400 | The request is malformed (`invalid-request`, `too-many-objects`). | Does not send it again. |
| 401, 403 | The credential (`unauthorized`), or not this rack's lease or object (`forbidden`). | Does not send it again. |
| 404 | What was asked for is not there (`environment-not-published`). | Does not send it again. |
| 408, 413 | The body came too slowly (`timeout`), or is over the route's limit (`too-large`). | Does not send it again as it was. |
| 422 | The request was read and its content is refused (`output-rejected`, `output-incomplete`); the lease stays claimed. | Puts it right (uploads again, commits what is missing) and completes again. |
| 426 | Another rack protocol (`upgrade-required`). | Marks the source incompatible. |
| 429 | The source is serving this rack as many transfers as it serves one rack at once (`busy`), with `retryAfterMs`. | Waits that long and asks again; it is no failed try. |
| 503 | The source could not do it now (`source-unavailable`): the repository's session did not answer, or the outcome or the log lines were not stored. | Sends the same request again, with backoff. |
| Other 5xx | The source's own failure. | Sends the same request again, with backoff. |

What grows travels as JSON text inside the fixed structs, read for the fields
a build knows and ignoring the rest (`readRackReport`, `readRackOffer`): each
heartbeat's `report` says what the rack is and has (its `features`, the
platform it installs environments for, its cores, memory and GPUs and what of
them is free), and each poll's `offer` says how much the poll may be answered
with. A lease's event and result were JSON already.

A function call's lease carries the `run-detached` event: its program by hash
in the lease's closure, and its arguments inline, a dataset's or a large
value's by hash. Its result's `detached` outcome (`RackFunctionResult`) holds
the value inline (`valueB64`) up to 192 KiB (`RACK_INLINE_VALUE_MAX`). A larger
value goes as an object only to a source whose hello names `call-value-objects`:
the agent stages it as the lease's output, the completion commits it, and the
outcome names it (`valueHash`, the completion's `outputHash`). To any other
source the agent says the value is too large to relay (`rackResultTooLarge`),
and the call runs there. Such a source stages nothing of a call, which writes
nothing to its store: it refuses a call's lease the staging of an output
(`403 forbidden`), and a completion that names a value by hash
(`400 invalid-request`).

A unit's lease names its split task's execution (`event.scope`: `{ "id",
"feeds" }`, `RackLeaseScope`) only to an agent whose report names
`split-scopes` (`RACK_SPLIT_SCOPES`): every other is granted the lease
without it. Such an agent may keep what a lease of a scope wrote, once its
source holds it, for the later leases of the scope (those `feeds` says read
it), and lets it go when a heartbeat's answer names the scope in
`x-e3-rack-scopes-ended` (`RACK_SCOPES_ENDED_HEADER`, a JSON array of ids,
read with `readRackScopesEnded`): each scope is named once, to the racks
granted a lease of it, when its session ends it or ends. An answer lost on
its way is not sent again, so an agent bounds what it keeps by its own time
too.

An agent that composes environments reports the feature `environments` and its
`target`, the platform it runs them on as e3-core names one
(`x86_64-manylinux_2_28`). A lease that names an environment
(`event.environment`, the spec's hash) is granted only to such an agent, for
whose platform the source keeps the environment's layers. The agent asks
`/api/rack/storage` with `envManifest` set to that hash, and is answered the
manifest (`EnvLayerManifest`, JSON: `baseTier` the lease's tier, `baseImage`
`rack-tier:<tier>`) and, for each layer in the order it is applied, its digest
(`sha256:<hex>` of its bytes), its size and a data URL, served with the
bound, the ranges and the tries of any transfer. A layer is a gzip tar
(`application/vnd.oci.image.layer.v1.tar+gzip`) whose entries are files,
directories and links that stay inside the tree, all under
`var/task/.e3-env/`: the interpreter, what the lock installs, and the
project's own files. The agent checks each against its digest, composes them
over the tier's image for that lease alone, and names the tree to its guest in
`E3_BAKED_ENV_HASH` and `E3_BAKED_ENV_DIR`; e3-core in the guest links the
environment to it and installs nothing. An environment it cannot compose ends
its lease with the reason `environment-failed`.

An agent that composes environments **built over a tier** reports the feature
`environments-over-tier` and, in `tiers`, each tier it boots them over: the
digest of the tier image's manifest (`/opt/e3/tier-manifest.json`, which the
image's build writes: `sha256:<hex>` of its bytes) and, to a source whose
hello names `tier-manifests`, the manifest's text:

```json
{ "features": ["resources", "environments", "environments-over-tier"], "target": "x86_64-manylinux_2_28",
  "tiers": { "py-datascience": { "digest": "sha256:c41d…", "manifest": "{\"distributions\":[…],\"namespaces\":[…],\"python\":{…},\"version\":1}\n" },
             "node": { "digest": "sha256:5e07…", "manifest": "{\"node\":{\"packages\":[…],\"registry\":\"https://registry.npmjs.org/\",\"root\":\"/usr/local/lib/node_modules\",\"version\":\"22.23.5\"},\"version\":2}\n" } } }
```

A python image's manifest is form 1, its Python alone (e3-core's
`tier/tier-manifest.py` writes it). A node image's is form 2, a section for
each runtime the image holds (`tier/tier-manifest.mjs`): its Node, the global
`node_modules` directory, the registry it installed from, and each of East's
packages there, by name and version. An agent reports only a manifest its
e3-core reads: one whose e3-core reads form 1 alone leaves a node image out,
and is answered whole node environments for it.

The text goes with the agent's first heartbeat to the source, and then only
with the heartbeat after an answer whose `x-e3-rack-tier-manifests-wanted`
header names its digest: a JSON array of the digests whose text the source
holds none of (it started again). A text that is the bytes its digest names,
and that the source still refused, is asked of no rack, since every rack's
text of that digest is those bytes; a text that is not, of the rack that sent
it alone. Every other heartbeat names the digest alone. An agent that does
not read the header may send the text every time, as agents did before it.

A source keeps a manifest whose text is the bytes its digest names, for as
long as a rack reports it, and builds an environment over it. The manifest
such an agent is then answered may say `over: { "tier", "manifest" }`: its
layers hold nothing that image holds, and a python environment's no
interpreter. The agent composes them only over the image whose manifest has
that digest, and then links the environment to the image with e3-core's
`composeEnvironmentOverTier(<tree>, readTierManifest(<the image's manifest>))`:
a python environment's interpreter to the image's base interpreter, and each
of East's packages a node environment left to the image, which its
`.e3-tier-links.json` names, to `<root>/<name>` of the image's Node. No layer
holds a link that leads out of the environment, so those links are the
agent's to make. An agent that reports the feature is still answered a whole
environment when its source built one: for an environment that does not fit
the image, and for one whose build over the image failed, which its source
then builds whole for the platform.

A lease says what it asks of a rack, in its event's `resources`: `{ "kind":
"unit", "cores": 1, "memoryBytes": 3328599654, "reserveBytes": 2219066436,
"gpu": false }`. `memoryBytes` is its **cap**: the most memory the work may
use. `reserveBytes`, at most its cap, is what the rack books for it (absent,
its cap). A unit of a split task asks one core, reserves what it is expected
to need and is capped as e3 caps a local unit that expects the same (half as
much again); a whole task asks its size's cores, at most the most cores a
rack has (a VM is given no more than its host has), and reserves its cap, its
rule's `--memory-limit`, else its size's memory. A rack that books
reservations must do what a local run's budget does with them: let each
lease's work grow to its cap, watch its host's memory, and when the host runs
short stop the newest work it holds, nothing it wrote sent, ending its lease
`requeued-pressure` with the peak it reached. Memory a VM cannot give back (a
GPU's, which the device pins) is booked at its cap. A unit whose
cap would pass its rule's limit is not queued, and runs locally:
`[LOCAL] score_rows (memory-limit-exceeded: needs 3 GB, limit 2 GB)`.

A poll is answered with the first lease in the queue, in its fair order, that
the poll's `offer` holds (`leaseFits`: its cores, its GPU and what it
reserves), and whose cap all the rack's memory holds (`leaseFitsRack`). One the offer does not hold is passed
over, by smaller work behind it, for ten seconds (`RACK_PASS_OVER_MS`), and
then holds the line: nothing behind it is granted to that rack until the rack
has room for it. A poll answered with no work (`204`) while such a lease waits
says what the oldest asks, in `x-e3-rack-waiting`
(`{"cores":1,"memoryBytes":34359738368,"gpus":0,"ms":12000}`), so the rack
holds that much back, across its sources, until it can offer it. A lease a
rack could never hold, with nothing else on it, holds no line there. A lease
that names no resources, from a source that does not size its leases, fits
any offer.

The hub's control socket and a session's data socket answer the same way: the
BEAST2 of the route's own type, and a refusal as a status with its reason in
plain text.

This implementation speaks e3-cloud's v2 task/unit leases with per-object
uploads. The protocol golden fixtures (`wire-golden.ts`) fix every struct's
bytes; rack protocol 3 changed the lease request and the heartbeat, by one
field each, and the cancellation-watch fixtures match the companion agent
([e3-cloud #254](https://github.com/elaraai/e3-cloud/pull/254)). The test rack
agent executes real e3 runners and exercises the transfer path, over TLS with a
pinned certificate; those tests do not establish KVM or hardware acceptance for
the deployed agent. A companion agent must bundle e3 at least as new as this
release, and pin the hub's certificate; an older bundle falls back locally.

See [the epic reconciliation](../../design/e3-rack-reconciliation.md) for the
changes required by current cloud and workspace APIs, wire migration rules,
and the remaining companion work. `tools` and `image` environments on a rack,
environments from a Windows launching machine, a local API server's calls on a
rack, split calls on a rack, automatic reconnect after hub restart and embedded
UI integration are deferred.
