# Rack delegation from a local repository

Part of the `e3` skill.

**Setup and routing**

| Signature | Description | Example |
| --- | --- | --- |
| `e3 rack enroll --listen <host:port> [--allow <ip,...>] [--advertise-url <origin>] [--label <label>] [--no-wait]` | Starts the user-wide hub and prints the source origin, the hub's certificate SHA-256, the matching release and a single-use token for the companion's hidden prompts. Waits for a new registration, not activation. Behind an SSH reverse tunnel, listen on the loopback and advertise the relay's origin. | `e3 rack enroll --listen 127.0.0.1:7331 --allow 127.0.0.1 --advertise-url https://relay.example:7401` |
| `e3 rack policy [repo] set <glob> rack\|local [--size <size>] [--memory-limit <size>] [--gpu] [--timeout <min>] [--allow-host-access]` | First whole-task-name match wins; `*` and `?` are wildcards; setting a rule again replaces it whole. Size: serverless (2 cores, 2 GiB), small (2, 4 GiB), medium (4, 8 GiB), large (8, 16 GiB), xlarge (16, 32 GiB). `--memory-limit 8G` is a ceiling on one piece's cap, never a request; `--gpu` asks for a rack's GPU. | `e3 rack policy . set 'train_*' rack --size large` |
| `e3 rack policy [repo] enable\|disable\|mode <opt-in\|auto>` | Enable/disable saved opt-in; `mode auto` selects eligible unmatched tasks. Defaults: disabled, opt-in. | `e3 rack policy . enable` |
| `e3 rack policy [repo] defaults [--no-spill] [--claim-timeout <sec>] [--retry-task-failures-locally]` | Defaults: large, 1440-minute timeout, spill on, 30-second claim recheck, no task-failure retry. | `e3 rack policy . defaults --no-spill` |
| `e3 rack policy [repo] show\|unset <glob>\|reset` | Inspect rules, remove an exact pattern, or delete the saved policy. | `e3 rack policy . show` |
| `e3 dataflow run <repo> <ws> --rack\|--no-rack\|--rack-only` | Select rack routing for this run; rack-only disables capacity spill but keeps infrastructure fallback. ❗ Refused for remote URLs. | `e3 dataflow run . dev --rack` |
| `e3 watch <source> <repo> <ws> --start --rack` | Reuses a rack session across watch runs and refreshes capacity; a second Ctrl-C stops the watch at once. ❗ `--rack` and `--rack-only` require `--start`. | `e3 watch src/main.ts . dev --start --rack` |
| `e3 rack status\|list\|remove <id-or-label>\|approve <id-or-label>\|stop` | Inspect fleet, revoke a rack, admit the boot a quarantined rack last reported, or stop the shared hub. Status never starts an absent hub, and lists how its last leases ended, each with its reason. | `e3 rack status` |
| `e3 rack config [--listen <host:port>] [--allow <ip,...>] [--idle-exit <min>] [--advertise-url <origin>] [--tls\|--no-tls] [--require-approval\|--no-require-approval]` | Configure the shared listener (off by default; HTTPS with the hub's own certificate unless `--no-tls`); every rack and data URL is built on `--advertise-url` when set; zero idle-exit disables automatic shutdown; `--require-approval` quarantines a rack after each reboot until `e3 rack approve` admits it (enrollment admits the first boot). ❗ Plain HTTP only on the loopback or a private address, with `--allow`. | `e3 rack config --listen 10.0.0.5:7331` |

The local process owns graph planning, repository and cache. After a cache
miss, eligible plain task, map and merge bodies can execute on the rack; input
closures and every output object transfer by hash. The session verifies the
whole output graph before success. Placement never changes task/cache hashes.
Local bodies and fallback share the original cores/memory budget; rack bodies
use remote capacity: each lease asks its cores and its cap (a split task's
piece one core and half as much again as it was measured to need; a task its
size's cores, and its `--memory-limit`, else its size's memory), a rack is
given only what its free resources hold, and a run is as much wider as the
racks have cores. `e3 rack list` shows each rack's resources and what is free. A run prints `[RACK] <task> → <rack>` when a rack claims a
task, `[RACK] <task> input transfer retried (2 of 5): <cause>` for a transfer
given another try, `[LOCAL] <task> (<reason>)` for a rack's work this machine
runs after all (`spill`, `no-rack-for-tier:<tier>`, or the rack's reason, such
as `input-transfer-failed: <cause>` or `guest-crashed: <detail>`, or
`memory-limit-exceeded: needs 3 GB, limit 2 GB` for work whose cap passes its
rule's limit or every rack's memory),
`[RACK] <task> waiting: needs 4 GB, <rack> has 1 GB free` for work queued with
no rack having room for it, and ends
with `Rack summary: 1 task and 12 units on <rack> · 0 waited for capacity · 1
transfer retried · 0 ran locally`. Calls, mutations and intake stay local. Stock runner
configurations qualify; commands, custom environments/platforms and unscannable
IR stay local. Host file/environment/network access stays local unless a rule
deliberately grants `--allow-host-access` and its resources exist on the rack.

The listener serves HTTPS with the hub's own self-signed certificate, made on
first use and kept in `hub-tls.beast2`; a rack pins it by its SHA-256, which
enrollment prints, so TLS runs end to end through any relay or tunnel. The
usual path is an SSH reverse tunnel from the developer machine to a relay the
rack reaches, with the hub on the loopback (`--allow 127.0.0.1`) and the relay's
origin advertised. Removing the certificate file, with the hub stopped, makes a
new one, which every worker must then pin again. `--no-tls` is for a TLS
terminator in front of the hub; the hub refuses plain HTTP on a wildcard or
public address, or without `--allow`. A listener on every address needs
`--advertise-url` to enroll.

The handoff targets a prepared independent worker VM with the matching verified
`e3-rack` release. Its `configure --allocation <host-provisioned-path>` prompts
for the source origin, the certificate SHA-256 for an HTTPS origin the hub
serves, the worker label and settings; `enroll --allocation <path>` prompts for
the one-time token. Origins, pins and credentials are encrypted together. A
plain-HTTP origin needs `--allow-vpn-http` on both commands and host
authorization for that exact endpoint, and belongs only on a path encrypted end
to end, such as an SSH tunnel, never across a VPN hub that decrypts traffic.
Never put a source address or token in worker command arguments or plaintext
files. The local mint intentionally displays its token; do not log that output.

Enrollment does not start services or authorize task claims. The local CLI
observes a new registration (optionally filtered by label); compare it with the
worker's result. Before a first heartbeat, status is `enrolled-not-started`.
After managed resume, a ready heartbeat advertises free plus occupied slots;
busy workers stay eligible. Fenced, draining or stopping workers withdraw their
capacity and show `unavailable`. After 45 seconds without a heartbeat, readiness
expires; lease polling cannot prolong it. Source boot approval, when required,
remains an additional gate. This advertisement does not authorize host resource
admission or removal of service/network quarantine.
Resources and mutable whole-GPU assignments belong to the host lifecycle, not
local enrollment flags. The companion accepts up to 32 mutually trusted sources
in one worker. After draining and stopping its services and sockets, use
`configure --allocation <path> --add-source`, confirm the shared trust boundary,
and enter the additional origin privately. It prints the new source UUID for
`enroll --allocation <path> --source <UUID>`; add `--allow-vpn-http` to both for a
plain-HTTP origin. All sources must be enrolled before startup. Each has its own identity,
client, cache and completion journal; actual execution shares one worker-wide
task/GPU limit. Per-source capacity reports are not additive reservations.
A worker is the trust boundary: a shared agent process can access all its
sources' credentials, so separate clients, and a cloud deployment and developer
hubs, need separate worker VMs. The hub keeps no task data; what a worker keeps
between tasks is its own policy, and an agent that keeps nothing works unchanged. Worker-local `source list --allocation <path>`
prints UUIDs/enrollment status; `--show-origins` adds origins only on a terminal.
After drain/stop and source-side revocation, `source remove` or `source reset`
with `--allocation <path> --source <UUID> --acknowledge-revocation` asks for UUID
confirmation. Reset prints a new UUID for fresh enrollment; old pending results
and caches stay in the retired namespace. Other sources and retained data are
preserved, and host endpoint policy must be reconciled before activation. The
flag acknowledges revocation; it does not revoke remotely.

Worker-local `registry status --allocation <path>` reports only whether encrypted
registry credentials are present; it can run while active and does not test access.
After drain/stop, `registry configure --allocation <path>` privately prompts for
username/token without re-entering settings. `registry clear --allocation <path>`
asks for the installation UUID and removes only the stored access. Both require
the same release, the writer lock and no unresolved enrollment/service transition;
they preserve current identities, rotations, settings, journals and cached data.
Credentials stay in the existing encrypted bundle, with no Docker login file.
A later activation receives them; services remain stopped and the next boot fenced.
Repeating configure with the same values or clear when absent does not write.
Clearing/replacing does not revoke a token remotely or purge cached images.

The companion's
`reconcile-services` applies a host-provided next allocation and service budgets
after a completed drain, with stopped units, the previous plan hash and exact
operation/boot binding. It retains ciphertext/journals and network quarantine;
it does not move a GPU, start a worker or change its executable release. For a
compatible release change, invoke the target verified executable's `switch-release`
with the same drain/plan bindings and unchanged resource budgets at the next
allocation generation. It checks both managed-state contracts, updates only the
runtime version in the current encrypted configuration, and preserves identities
and journals through interruption or downgrade. Both four-file releases must stay
available; a downgrade is a new operation, never a saved-state restore. Services
stay stopped and quarantined. If the selected release never resumed, the exact
recorded previous executable's `recover-release` binds the completed release
receipt, current plan and new operation at another generation increase. It
requires the original drain or a valid fenced journal with no operation at the
failed generation, verifies both releases' recorded hashes, and preserves current
credentials and journals. A prior resume attempt, even across reboot, refuses
recovery. General journal repair remains unfinished. Named host management, source aliases, network
activation, incompatible-state migrations and hardware acceptance remain
companion cloud #253 work. This and durable completion retry are implemented in
companion PR #254, separately from the original main protocol pin.

Policy is `<repo>/rack/policy.beast2`; hub state is `~/.e3/rack` (or
`E3_RACK_HOME`). A hub `dataflow run` starts exits after 15 idle minutes, and a
run waits up to 10 seconds for an enrolled rack to report healthy (with none
enrolled, or a policy that selects no task for a rack, it starts at once): run
`e3 rack hub` as a service, or set `--idle-exit 0`, for a hub racks can always
reach. A data URL lasts 15 minutes, which a transfer may use whole; an object is
at most 5 GiB. The hub serves one rack eight transfers at once (one more is told
to ask again), and reads an object from a byte on (`Range`), so a transfer a slow
link cut short resumes; it keeps a rack's idle connection for 75 seconds.
A hub and the e3 that calls it speak control protocol 3 exactly:
a hub an older e3 started is asked to exit once idle, and `e3 rack stop` with
that e3 replaces it now. A rack's agent and its source speak rack protocol 3:
an agent of another protocol is refused by name each time it asks, and
`e3 rack list` shows its rack as `incompatible: …; update the rack` until it is.
Agents must report bundled e3 at least the project's release. Infrastructure
failure falls back locally with a separate execution attempt, as does an
attempt the rack stopped on its own; the run's own cancellation and the task's
timeout never do. One cancelled subscriber does not stop work shared by other
sessions of the same canonical repository and e3 release.

**Programmatic attachment** (`@elaraai/e3-rack`)

| Signature | Description | Example |
| --- | --- | --- |
| `openRackRunner({ repoPath, workspace, storage, label, budget?, settings?, policy?, rackOnly? })` | Opens a runner/session; preserve the caller's existing budget and process settings, use `rackSlots` to extend orchestrator width, and close in `finally`. | `const rack = await openRackRunner({ repoPath, workspace: 'dev', storage, label: 'run', budget });` |
| `createDataflowRunnerFactory(options?)` | Pass to `createServer({ dataflowRunner })`; one session per API dataflow, using the server's shared budget. Explicit server opt-in overrides policy.enabled; rules still apply. | `const server = await createServer({ reposDir: './repos', dataflowRunner: createDataflowRunnerFactory() });` |

The API server's optional rack package is needed only for
`e3-api-server --repos ./repos --rack`. Portable handlers receive a runner
factory and do not import hub code. Custom environments, remote function
delegation, automatic reconnect after hub restart and embedded UI integration
are deferred.
