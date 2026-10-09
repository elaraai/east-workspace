# @elaraai/e3-rack

Delegate eligible task bodies from a local e3 repository to a rack agent. The
local process still plans the graph, checks caches and owns the repository.
One hub per operating-system user coordinates the rack fleet across projects.

## Connect a rack

The rack must reach this machine over a trusted LAN or VPN. Use the machine's
address on that network, and keep it reachable while work runs:

```sh
e3 rack enroll --listen 100.64.0.10:7331 --label workshop --instance local-dev
```

This starts the hub, creates a short-lived single-use enrollment token, and
prints the exact command to run on the Linux rack host. It uses the companion
`e3-rack` installer from e3-cloud, pins the project's e3 release, selects
`node,py`, and explicitly sets `--max-vms 2 --gpus none`. The command has this
shape (use the actual token and version printed by enrollment):

```sh
sudo ./e3-rack install --instance local-dev --api-url http://100.64.0.10:7331 \
  --token <enrollment-token> --e3-version <project-version> \
  --tiers node,py --max-vms 2 --gpus none --label workshop
sudo systemctl status e3-rack-agent@local-dev
sudo journalctl -u e3-rack-agent@local-dev -f
```

The instance has its own service, configuration and credentials. Choose a
distinct instance name when the host already serves cloud workloads. Instances
share physical CPU, memory, disks and devices; `--max-vms` limits VM count, not
CPU or memory reservations. GPU routing is opportunistic and is not a promise
of GPU availability. Select the required runtime images with `--tiers`.

The enrollment command waits for the first heartbeat; `--no-wait` returns
after printing the install command. Use `--allow <rack-ip,...>` to restrict the
listener's clients. The listener is HTTP with bearer credentials and expiring
object capabilities: bind it only on a trusted private network, or put TLS in
front of it and configure `e3 rack config --advertise-url https://…`.

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
address is present on this machine and the port is free. After a VPN address
changes, update `e3 rack config --listen <new-ip>:7331` and the agent's API URL.
If a rack is incompatible, update that instance with the pinned e3 release
and required tiers; the first use of a new release may need runtime images to
be built or fetched. Check its systemd journal while waiting. If a task stays
local, inspect `rack policy show`, the task's runner/platforms and host-access
dependencies; `--rack-only` cannot override eligibility.

Public package entries are `@elaraai/e3-rack` (local hub/client/routing/runner
APIs), `@elaraai/e3-rack/protocol` (wire types),
`@elaraai/e3-rack/testing` (test agent and contracts), and
`@elaraai/e3-rack/hub-main` (hub process entry point).

This implementation targets e3-cloud main at
`43d9ac9d9a423b69450320f6a802a8191ffefd53`, with v2 task/unit leases and
per-object uploads. Protocol golden fixtures come from that pinned source;
the test rack agent executes real e3 runners and exercises the transfer path.
Those tests do not establish KVM/hardware acceptance for the deployed agent.
Cloud #193 still needs request deadlines and durable completion retry for
intermittent connectivity. The explicit installer flags above avoid relying
on the unsafe multi-instance defaults tracked by cloud #192.

See [the epic reconciliation](../../design/e3-rack-reconciliation.md) for the
changes required by current cloud and workspace APIs, wire migration rules,
and the remaining companion work. Custom environments, remote function calls,
automatic reconnect after hub restart and embedded UI integration are deferred.
