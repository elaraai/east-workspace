# Composite records

A composite record is one record over several **sources**, each the authority
for its own entries: the entries another system delivers, which only that
source's load writes, beside the entries the solution keeps itself, which its
mutations write. It is a record in every other way — read, paged, indexed,
bound, migrated and packaged as one.

Search the example index for a tested declaration (`recordComposite`,
`package: "e3"`). This page carries the rules a declaration is held to, and
how a composite behaves once deployed.

## Declaring

`e3.recordComposite(name, row, { sources, initial?, indexes?, mutations?, migrations? })`
takes the type of a row, and builds the record's type from its sources:
`Dict<Variant{ <source>: <key>, … }, Row>`. An entry's key names its source —
`variant('own', id)` — and each source's entries are one run of the record.

| Part | What it declares |
|---|---|
| `sources: (source) => ({ … })` | Each source by name, declared first: the parts after it are handed the types it makes. A name is an identifier: it is a case of the record's key. |
| `source.load(key, delivery, fn, { runner? })` | An **external** source: its key type, the type of what it is delivered, and the load, `fn: (delivery, Dict<key, Row>) -> PatchType(Dict<key, Row>)`. The function sees the source's own keys; e3 puts the source's case on each. It is pure and synchronous, as a mutation's body is, and must give the right entries from one delivery alone, whatever was loaded before, as `East.diff(current, delivery)` does. |
| `source.mutations(key)` | A source of the solution's own, written by the record's mutations. |
| `initial: { <source>: entries }` | The entries of each source of the solution's own, by the source's own key. An external source has none: its entries come from its load. |
| `indexes`, `mutations`, `migrations` | As `e3.record`'s, each builder handed the record's types as a second argument: `(mutation, { state, key, edit }) => …`. `state` is the record's type, `key` its key's, and `edit` the type of an edit body's last parameter, which writes the solution's own entries alone. `e3.record`'s builders are handed the same argument. |

Refused where the record is declared, naming it: no `sources`, or none
declared; a source named by no identifier, or keyed by a type no Dict is keyed
by; a load whose function is not `(delivery, entries) -> patch of the entries`;
`initial` naming no source, or an external one, or holding anything but the
source's entries by its own key; and mutations declared on a record whose
every source is a load's, which has no entry for them to write.

## Writing

Only a source's load writes an external source's entries. A write of one by
anything else is refused as `invalid`, naming the key and its source, and
nothing is written:

```
mutation 'patch' writes .erp "SO-1001", an entry of source 'erp', which only its load writes
```

- An `edit` body typed by the builder's `edit` does not compile when it writes
  an external entry. A body that takes the wider `e3.mutation.editType(state)`,
  a reducer and a patch are each refused where the write is tried: on a Save
  (`e3 mutate`, the API), and on a call's draft, which ends the call `invalid`
  in the Save's words, its function not run.
- `e3 seed` is refused for a composite: it takes no state whole, since each
  entry is one of its sources'.

## Before a source's first delivery

A composite always holds a state: the entries of the solution's own sources.
Until an external source has delivered once, that state is part of the record,
so nothing computes on it:

- **A task** whose input is the record, or an index of it, waits, as on an
  input nothing has set. The run goes on without it and its dependents, counts
  them under `Waiting:`, and says for which sources:
  `[WAIT] forecast: record 'orders' waits for the first delivery of erp`.
  The workspace's status gives the same reason.
- **A function** that declares the record, or an index of it, among its
  `inputs` ends its call `invalid`, naming the record and the sources, and
  does not run.
- **A dataset argument** naming the record is read as it stands, as the
  record's own routes serve it: a person looking at the record sees their own
  entries before the first delivery.
- **Mutations** of the solution's own entries commit throughout.

Which sources a record still waits for is kept on the record, and a deploy
keeps it right:

- a record minted, or reset to its initial value, waits for every external
  source;
- a source handed to a load while the record holds entries of it — entered by
  hand under an earlier version, or put under it by a migration's `rekey` —
  counts as delivered, and its readers run on those rows;
- a source handed to a load holding none waits; one that waited still waits
  after a redeploy; and one that is no longer external waits for nothing.

A record's description names each source — whether its load alone writes it,
what it is delivered, its last delivery, and whether the record still waits
for its first (`recordDescribe` in e3-core, the describe route's `sources`).

## Loading a delivery

```
$ e3 load . orders.erp ./erp-orders.beast2 -w main --as-of 2026-11-02T03:00:00
Taking the delivery in… done
Pieces 37/37
Loaded orders.erp at 3f2a9c1e5d7b, as of 2026-11-02T03:00:00.000: 1,204 set, 31 deleted, 98,112 unchanged

$ e3 load . orders.erp '#<sha256 of erp-orders.beast2>' -w main      # the same delivery, by its hash
orders.erp already holds this delivery, loaded at 3f2a9c1e5d7b

$ e3 load . orders.erp ./erp-orders-1-nov.beast2 -w main --as-of 2026-11-01T03:00:00
orders.erp holds a delivery as of 2026-11-02T03:00:00.000, later than this one's 2026-11-01T03:00:00.000: nothing loaded (superseded)
```

- **The delivery** is a `.beast2` file of the source's delivery type, or
  `#<hash>`: a value the repository holds, by its SHA-256 in 64 lowercase hex
  digits. A file is checked against the type, then stored as the object its
  bytes are, never read whole or modified — against a server, uploaded so — so
  a file and its hash name the same delivery.
- **One commit.** The load takes the delivery in, runs the source's load over
  it and the source's entries in pieces, each cached, and commits once, as
  `$load:<source>`. Saves of the solution's own entries that land meanwhile
  do not hold it up: its commit applies over them. One that finds the source's
  entries changed under it — a rollback, a restore, a migration — goes back to
  its pieces, those that did not change from the cache: `Loading again: the
  entries of source 'erp' changed under its load`.
- **In turn.** One source's loads apply one at a time, in the order asked; a
  load asked while another runs says `Waiting for an earlier load of orders.erp
  to finish…`.
- **`--as-of <time>`**, as East writes a time, in UTC: a delivery older than
  the source's last is answered `superseded`, and nothing runs. The source
  keeps the latest as-of any of its deliveries carried.
- **A deploy or an export** of the workspace stops a load while it runs, and
  the load goes on once it is done: `Stopped: a deploy of main started. The
  load goes on once the deploy is done…`. A removal of the workspace, or a
  copy onto it, fails the load: `a copy onto main replaced the workspace:
  nothing loaded`.
- **Ctrl-C** asks the load to cancel, and follows it to its end: `Cancelling
  the load…`, then `Cancelled: nothing loaded.` (exit 130), or what the load
  did, when its commit had written. A second Ctrl-C stops following a
  server's load, which goes on.
- **Refused** before anything is stored or sent: a record or source the
  workspace does not hold, a source of the solution's own, and a file of
  another type, each named.

`e3 history` says what a load's commit loaded, and `--delta` what it changed,
per target, as a mutation's:

```
3f2a9c1e5d7b  $load:erp           cli:ada           2026-11-02T03:00:12.000Z  delivery 5e7a3b0c9d1f as of 2026-11-02T03:00:00.000: 1,204 set, 31 deleted, 98,112 unchanged
```

## Rollbacks, restores and compactions

- A **rollback** forgets each delivery it undoes: its source names no last
  delivery, though the record may hold an earlier delivery's entries again.
  One that undoes a source's first delivery leaves the record waiting for it
  again; a later rollback to a state holding the source's entries ends the
  wait, the delivery still forgotten. A delivered source is loaded again when
  it is sent again.
- A **restore** forgets every source's delivery, and the record waits for
  each external source the restored state holds no entry of.
- A **compaction** keeps each source's last delivery, and its as-of: the
  commit that applied it is cut from the chain, so the source names none.

## From code

```ts
import { none, some } from '@elaraai/east';
import { objectUpload, workspaceRecordLoad } from '@elaraai/e3-api-client';

// A file is sent as the object it is (its bytes, size and SHA-256: a DatasetTransferSource), writing no ref
const delivery = await objectUpload(url, 'repo', 'main', file, { token });
const loaded = await workspaceRecordLoad(url, 'repo', 'main', 'orders', 'erp',
  { delivery, actor: none, asOf: some(new Date('2026-11-02T03:00:00Z')) }, { token },
  { onProgress: (progress) => console.log(progress.type), signal });
// loaded.outcome: loaded, again or superseded; loaded.set, .deleted, .unchanged
```

The load runs on the server as a job, which `workspaceRecordLoad` follows to
its end; an abort of `signal` asks the job to cancel, and follows it to the
end it writes. In a process of its own, e3-core's `recordLoad(storage, runner,
repo, ws, record, source, delivery, { actor, asOf, onProgress, signal })` runs
the same load over a delivery the store holds.
