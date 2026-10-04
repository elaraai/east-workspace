# Wire migration rule

Every value e3 persists or ships is a beast2 value of a declared East type, but
a log, which is its runner's own text. A
struct's fields encode by position, so changing a type changes its wire: bytes
written under the old type do not decode under the new one. This document says
how a change to one is made, so that no change picks its own. The beast2
container itself is governed by
[`BEAST2_WIRE_VERSION.md`](./BEAST2_WIRE_VERSION.md).

What e3 keeps and ships names the release that wrote it — a repository's
record, an execution state, a package zip — and so does a transfer request,
beside the protocol number that decides whether a server takes it. The release
is the version the release scripts write into every package, and into
e3-types' `E3_RELEASE` with them (`scripts/set-npm-version.mjs`, guarded by
`scripts/check-version-drift.mjs`).

## One rule per kind

| Kind | Examples | At a change |
|---|---|---|
| **Package-borne** — written by the SDK at export and carried in a package | task objects, package objects, function objects, record, mutation and index objects, IR bundles, environment specs and the files they name (each a Blob), and the package zip's package ref and release (each a String) | Packages are re-exported with the new SDK. A package from an older SDK fails with an error that says to re-export it. An import refuses a zip a newer release exported, naming that release. |
| **Stored state** — written by e3 as it runs and kept in a repository | datasets and their segment manifests, record states, commits and deltas, execution status, the dataflow's execution state and its events, unit plans, and the repository's own records: its repository record and the upgrade under way, package refs, workspace state, dataset refs, execution owners and plan pointers, the adoption memo, locks and run records | The release that changes a stored form ships a repository upgrade step, and a repository an older release wrote is upgraded in place when that release first opens it: its records keep their states and histories. A reader refuses a stored form no step carried forward, naming the release that wrote it. A repository from before repositories recorded their upgrades is re-created: deployed again, and its data imported again. |

No reader keeps a decoder for an earlier form. Readers read the current form,
as writers write it; an upgrade step carries a repository's records into it,
and every other form is an error that says what to do.

A PR that changes a wire says which kind it changes.

## Making a change

- **A struct gains or loses a field, or a variant a case:** change the type.
  Where the old bytes could decode as something else, the reader refuses them
  by what it can see, rather than misreading them.
- **A stored form changes** — a record moves, is renamed or takes another
  type, or the dataflow's execution state gains an event: the release ships a
  named upgrade step that rewrites a repository's records into the new form.
  A change to a record's East type is every backend's, and its step goes
  through the storage backend (`REPOSITORY_UPGRADES` in e3-core's
  `repository-record.ts`), a dataflow run's state through the backend's
  run-state store (`StorageBackend.runStates`); a change to one backend's own layout — a local
  repository's files, the cloud's items — is that backend's step
  (`StorageBackend.upgrades`). A step is idempotent — it leaves a record
  already in the new form as it is — and once released it is never edited,
  reordered or removed. It applies in parts, so a host whose compute has a
  time limit applies a step of any size: each part goes on from where the last
  stopped, by a cursor of the step's own, which is kept beside the repository
  record (`RefStore.repositoryUpgradeRead`). Any process takes a step up from
  its cursor, and a step a crash cut short is taken up, not started again. A
  step's cursor, like the step, never changes once released. The repository
  record, which every backend keeps through its ref store, lists the steps a
  repository has had, each with the release that applied it, once each is
  done. Every way into a repository opens it (`repositoryOpen`): the steps it
  has not had are applied, the backend's before the shared ones, in order,
  before anything reads it and with the repository held still; and a
  repository that has had a step this e3 does not know is refused, naming the
  release that applied it. One with no repository record is refused before
  anything in it is read, naming the fix. A host whose requests have a time
  limit leaves the steps to a job of its own (`repositoryOpen`'s
  `apply: false`), which applies them a part per run
  (`repositoryUpgradeStep`).
- **A new object kind names other objects:** it carries a `kind` tag, and lands
  with a GC test. GC dispatches a tagged object on its tag, through a table
  listing the field names of each kind. An object whose fields begin with the
  kind's and that carries its tag is walked for the fields this build knows, so
  a later version that appends fields stays reachable. An object without a tag
  GC recognizes by its current shape.

## Frozen wires

These cannot change without breaking every reader of the bytes they name. A
change to one is a new version of the thing, not an edit to it.

- **The beast2 container:** its magic, its frame format and its index. Readers
  refuse index flag bits they do not know, so a new flag is a new container
  version.
- **The beast2 well-known type registry:** its ids are pinned.
- **The segment manifest** (`$segments`): readers recognize it by its exact
  field set, so a changed struct is a different object to every reader.
