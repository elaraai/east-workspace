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

```sh
e3 rack policy . show
e3 rack policy . enable                  # opt in without a flag on each run
e3 rack policy . mode auto               # route eligible unmatched tasks too
e3 rack policy . set 'ingest_*' local
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
listener is off until configured. A running hub and client must have compatible
control schemas (currently protocol 2 exactly); incompatible clients receive
an explicit diagnostic. Agents must report a bundled e3 version at least as
new as the project's. Stop and restart the hub after an incompatible upgrade.

A hub that `e3 dataflow run` starts exits after 15 idle minutes, while a run
waits up to 10 seconds for an enrolled rack to report healthy and fixes its
parallelism as it starts; with no rack enrolled, or a policy that selects no
task for a rack, it starts at once. An agent reconnecting after the hub exits
backs off for up to 30 seconds. For a hub racks can always reach, run
`e3 rack hub` as a service, or set `e3 rack config --idle-exit 0`.

A rack reads and writes each object through a data URL that lasts 15 minutes,
and a transfer may take all of it; an object is at most 5 GiB. Over a slow
link, a large object can outlast its URL, and the work then falls back locally.

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

This implementation speaks e3-cloud's v2 task/unit leases with per-object
uploads. The protocol golden fixtures come from e3-cloud's rack protocol, and
the cancellation-watch fixtures match the companion agent
([e3-cloud #254](https://github.com/elaraai/e3-cloud/pull/254)). The test rack
agent executes real e3 runners and exercises the transfer path, over TLS with a
pinned certificate; those tests do not establish KVM or hardware acceptance for
the deployed agent. A companion agent must bundle e3 at least as new as this
release, and pin the hub's certificate; an older bundle falls back locally.

See [the epic reconciliation](../../design/e3-rack-reconciliation.md) for the
changes required by current cloud and workspace APIs, wire migration rules,
and the remaining companion work. Custom environments, remote function calls,
automatic reconnect after hub restart and embedded UI integration are deferred.
