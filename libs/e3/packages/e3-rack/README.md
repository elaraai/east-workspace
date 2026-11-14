# @elaraai/e3-rack

Delegate eligible task bodies from a local e3 repository to a rack agent. The
local process still plans the graph, checks caches and owns the repository.
One hub per operating-system user coordinates the rack fleet across projects.

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
a piece needs. `--gpu` asks for a rack's GPU. Setting a rule again replaces it
whole. A policy an earlier release stored is carried into this release's form
when its repository is next opened, every rule as it was.

```sh
e3 rack policy . show
e3 rack policy . enable                  # opt in without a flag on each run
e3 rack policy . mode auto               # route eligible unmatched tasks too
e3 rack policy . set 'ingest_*' local
e3 rack policy . set 'score_*' rack --memory-limit 8G
e3 rack policy . set 'embed_*' rack --size xlarge --gpu
e3 rack policy . defaults --no-spill --claim-timeout 30
e3 dataflow run . dev --no-rack           # override the saved opt-in
e3 dataflow run . dev --rack-only         # wait when compatible racks are busy
e3 rack policy . unset 'train_*'
e3 rack policy . reset
```

Defaults are disabled, opt-in selection, `large`, a 1440-minute timeout,
capacity spill enabled, a 30-second claim recheck and no local retry of task
failures. `--rack-only` disables capacity spill; infrastructure failures can
still fall back locally. It does not force ineligible tasks onto a rack.
Rack flags apply to local dataflows and watch with `--start`, and are refused
for remote repository URLs. Calls, mutations and intake remain local.

Only stock runner configurations can delegate. Custom commands, environments,
platform extensions and unscannable programs stay local. Programs that access
host files, environment variables or network resources also stay local by
default: their dependencies may exist only on this machine. A task rule's
`--allow-host-access` deliberately overrides that guard, for a rack that
provides those resources itself. The companion agent's task VMs have no network
device, host files or injected environment, so such a task fails there.

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
  [RACK] train_model → workshop
  [RACK] train_model input transfer retried (2 of 5): connection reset
  [RACK] embed_rows waiting: needs 16 GB, workshop has 9 GB free
  [LOCAL] score_rows (input-transfer-failed: connection reset)
Rack summary: 1 task and 12 units on workshop · 0 waited for capacity · 1 transfer retried · 1 ran locally
```

| `reason.code` | Carries | Who sets it | The work |
| --- | --- | --- | --- |
| `input-transfer-failed`, `output-transfer-failed` | `attempts`, `cause` | The rack, after its five tries. | Runs locally. |
| `guest-crashed` | `detail` | The rack. | Runs locally: a rack's fault never fails a run. |
| `source-unreachable` | `ms` | The rack. | Runs locally. |
| `task-error` | | The rack: the task's own failure. | Its failure is its verdict, unless the policy retries failures locally. |
| `outgrew-cap` | `capBytes`, `peakBytes` | The rack, when the cap stopped the work. | Reserved for work a rack caps. |
| `memory-limit-exceeded` | `needsBytes`, `limitBytes` | The launching machine. | Reserved for work a rack caps. |
| `requeued-pressure` | `peakBytes` | A rack that runs several units in one VM. | Reserved. |

A result also lists the tries of its transfers that failed and were followed
by another (`retries`), which the run prints when the lease ends. A code a
build does not know is a rack's fault it cannot name, and the work runs
locally. `e3 rack status` lists how the hub's last twenty leases ended, each
with its reason. In code, `RackPlacementEvent` carries the same (`kind`
`placed` or `retried`, and a local placement's `detail`), and
`rack.takeSummary()` with `describeRackSummary` the line.

A rack that admits work by its resources reports all it has and what is free,
and the hub's fleet snapshot carries both for each such rack: what is free is
the less of what the rack last reported and what the hub's own leases leave of
all it has. The launching machine reads the snapshot for three things. The
racks are **full** when no compatible rack's free resources hold the lease,
less the work already queued: with spill on and a free local core the work
then runs locally (`spill`), and otherwise it is queued and the run says once
that it waits. Work **no rack could ever hold**, with nothing else on it, is
not queued: it runs locally (`memory-limit-exceeded: needs 32 GB, limit 16
GB`, or `no-rack-holds:gpu`). And a run is as much **wider** as the compatible
racks have cores (`rackSlots`), so a split task's pieces are queued together.
`e3 rack list` shows each rack's resources and features:

```text
LABEL  ID  RUNTIMES  BUSY/CAPACITY  AGENT  E3  LAST SEEN  RESOURCES  FEATURES  STATE
workshop  01a1da04-228  node,py  3/56  0.6.0+e3.1.0.108  1.0.108  2026-11-14T12:24:26.505  56 cores (41 free), 262 GB (120 GB free), 1 GPU (0 free)  resources  ready
```

A rack that reports no resources admits by its slots, as before: its row
shows `-`, and its work is counted in slots.

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
the same control protocol (3) exactly. A hub that an older e3 started is asked
to exit once idle, and the run that found it runs locally this time; `e3 rack
stop` with that e3, or ending its process, replaces it now. Agents must report
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

- It serves one rack **eight transfers at once**, the number its hello states
  (`limits.transfersAtOnce`). One more is answered `429 busy` with how long to
  wait, before any byte of it is read. An agent keeps to the hello's number
  itself, so it is not told to wait.
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
  "limits": { "transfersAtOnce": 8 } }`. An agent asks it before it spends an
  enrollment token.
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

A lease says what it asks of a rack, in its event's `resources`: `{ "kind":
"unit", "cores": 1, "memoryBytes": 3328599654, "gpu": false }`. `memoryBytes`
is its **cap**: the most memory the work may use, and what the rack books for
it, so a rack that books the cap of everything it holds never books more than
it has. A unit of a split task asks one core and the cap e3 gives a local unit
that expects the same peak (half as much again); a whole task asks its size's
cores, and its rule's `--memory-limit`, else its size's memory. A unit whose
cap would pass its rule's limit is not queued, and runs locally:
`[LOCAL] score_rows (memory-limit-exceeded: needs 3 GB, limit 2 GB)`.

A poll is answered with the first lease in the queue, in its fair order, that
the poll's `offer` holds (`leaseFits`). One the offer does not hold is passed
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
and the remaining companion work. Custom environments, remote function calls,
automatic reconnect after hub restart and embedded UI integration are deferred.
