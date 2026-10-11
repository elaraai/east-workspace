# @elaraai/e3-rack

Delegate eligible task bodies from a local e3 repository to a rack agent. The
local process still plans the graph, checks caches and owns the repository.
One hub per operating-system user coordinates the rack fleet across projects.

## Connect a rack

The rack must reach this machine over an authenticated VPN, or HTTPS through a
TLS terminator. Use the machine's reachable address, and keep it available while
work runs:

```sh
e3 rack enroll --listen 100.64.0.10:7331 --label workshop
```

This starts the hub and prints the **source origin**, matching e3-rack release,
and a short-lived single-use enrollment token. The source origin is this
machine's rack listener, for example `http://100.64.0.10:7331`, not a repository
URL or the rack server's address. `localhost` on the rack would point back at
the worker itself.

Use the matching, verified companion release from e3-cloud **inside an already
prepared worker VM**. Replace the public allocation path below with the one the
host provisioner supplies; do not write allocation JSON yourself:

```sh
sudo /opt/e3-rack/releases/1.0.86/e3-rack configure \
  --allocation '/var/lib/e3-rack/<agent-uuid>/allocation.json' --allow-vpn-http
sudo /opt/e3-rack/releases/1.0.86/e3-rack enroll \
  --allocation '/var/lib/e3-rack/<agent-uuid>/allocation.json' --allow-vpn-http
```

`configure` asks for the source origin, worker label (`workshop` here), runtime
settings and optional private-registry access. `enroll` asks for the one-time
token. Both use hidden terminal prompts. The worker stores origins, identities,
settings and registry credentials together in encrypted storage; no token or
source address is included in the printed shell commands. The enrollment token
is intentionally displayed by this local minting command: do not copy its
output into logs or a plaintext file.

`--allow-vpn-http` is needed on both worker commands only for an endpoint carried
over an authenticated VPN. The host's endpoint policy must also authorize that
exact destination. For HTTPS, configure `e3 rack config --advertise-url https://…`
and omit the HTTP opt-in. `--allow <rack-ip,...>` restricts the local listener's
clients; it does not provide transport encryption.

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
Source boot approval, when required, remains a separate gate from worker resume.

Independent agents belong to separate worker VMs, each with its own identity,
encrypted configuration and host-enforced resource allocation. Whole GPUs are
assigned through the host lifecycle, independently of this enrollment command.
One worker can connect to up to 32 mutually trusted e3 sources. To add another,
first drain the worker and stop its services and socket activation. Inside it:

```sh
sudo /opt/e3-rack/releases/1.0.86/e3-rack configure \
  --allocation '/var/lib/e3-rack/<agent-uuid>/allocation.json' --add-source --allow-vpn-http
sudo /opt/e3-rack/releases/1.0.86/e3-rack enroll \
  --allocation '/var/lib/e3-rack/<agent-uuid>/allocation.json' --source '<new-source-uuid>' --allow-vpn-http
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
credential trust boundary, so separate clients and developer environments need
separate worker VMs. Independent agents have no shared e3 task scheduler.

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

The named host manager, source aliases, managed updates,
service/network activation and hardware acceptance remain
[cloud #253](https://github.com/elaraai/e3-cloud/issues/253) work. Enrollment alone
is not an end-to-end deployment. See the companion's
[worker configuration and service contract](https://github.com/elaraai/e3-cloud/blob/ef20d7e6fa7fefee694df776e167b8aa27991ebb/packages/e3-rack-agent/credentials/README.md).

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
`--allow-host-access` deliberately overrides that guard; provide any required
resources on the rack yourself.

## Execution and recovery

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
have distinct execution records. Timeouts and cancellation are not retried
locally. Task failures are returned unless the policy explicitly enables
`--retry-task-failures-locally`; infrastructure failures fall back locally.

Ctrl-C in `e3 dataflow run` requests cancellation of that run, including its
delegated work. A current companion agent keeps an outbound cancellation
request open while work is active. The source checks the watched leases every
250 ms and answers as soon as one stops; the agent aborts that task and destroys
its VM before waiting for log delivery. Other tasks and sources keep running.
The normal health heartbeat remains 15 seconds. Against an older source without
this endpoint, the new agent uses a one-second heartbeat while busy.

This targets cancellation delivery within about a second on a healthy connection;
network failures and VM/GPU teardown can take longer. The CLI's cancellation
message is not confirmation that the remote VM has exited. Killing the CLI
without allowing its signal handler to run relies on lost-session cleanup.

```sh
e3 rack status                         # does not start an absent hub
e3 rack list
e3 task logs . dev.train_model --follow
e3 rack remove workshop                # revoke this rack's credential
e3 rack stop                           # stop the shared hub
```

Hub state lives under `~/.e3/rack` (override with `E3_RACK_HOME`). The rack
listener is off until configured. A running hub and client must have compatible
control schemas (currently protocol 1 exactly); incompatible clients receive
an explicit diagnostic. Agents must report a bundled e3 version at least as
new as the project's. Stop and restart the hub after an incompatible upgrade.

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

If `rack status` reports a listener error, confirm the configured VPN/LAN
address is present on this machine and the port is free. Prefer a stable VPN
address. A changed source address needs a deliberate managed source transition;
re-running worker `configure` preserves an enrolled source's origin and identity.
If a rack is incompatible, its executable's bundled e3 must be upgraded along
with its runtime images. Managed `configure` deliberately refuses a release
change: use the reviewed version transition once that companion workflow is
available. Do not switch its executable symlink or erase its service plan and
journals to bypass this guard. If a task stays local, inspect `rack policy show`,
the task's runner/platforms and host-access dependencies; `--rack-only` cannot
override eligibility.

Public package entries are `@elaraai/e3-rack` (local hub/client/routing/runner
APIs), `@elaraai/e3-rack/protocol` (wire types),
`@elaraai/e3-rack/testing` (test agent and contracts), and
`@elaraai/e3-rack/hub-main` (hub process entry point).

This implementation targets e3-cloud main at
`43d9ac9d9a423b69450320f6a802a8191ffefd53`, with v2 task/unit leases and
per-object uploads. Existing protocol golden fixtures come from that pinned source;
the additive cancellation-watch fixtures match companion PR #254.
the test rack agent executes real e3 runners and exercises the transfer path.
Those tests do not establish KVM/hardware acceptance for the deployed agent.
The pinned cloud source bundles e3 1.0.85, while current workspace main is
1.0.86. Rebuild/release the companion agent against e3 1.0.86 or newer before
delegating from this workspace release; an older bundle falls back locally.
The companion [PR #254](https://github.com/elaraai/e3-cloud/pull/254) implements
request deadlines, prompt cancellation, durable completion retry, lockstep releases and encrypted
worker configuration, alongside the ongoing managed lifecycle work. Those
changes are separate from the main protocol pin above and remain subject to
their own CI, service and hardware acceptance.

See [the epic reconciliation](../../design/e3-rack-reconciliation.md) for the
changes required by current cloud and workspace APIs, wire migration rules,
and the remaining companion work. Custom environments, remote function calls,
automatic reconnect after hub restart and embedded UI integration are deferred.
