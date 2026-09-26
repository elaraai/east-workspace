# Wire migration rule

Every value e3 persists or ships is a beast2 value of a declared East type, but
a log, which is its runner's own text. A
struct's fields encode by position, so changing a type changes its wire: bytes
written under the old type do not decode under the new one. This document says
how a change to one is made, so that no change picks its own. The beast2
container itself is governed by
[`BEAST2_WIRE_VERSION.md`](./BEAST2_WIRE_VERSION.md).

## One rule: hard cutover

| Kind | Examples | At a change |
|---|---|---|
| **Package-borne** — written by the SDK at export and carried in a package | task objects, package objects, function objects, record, mutation and index objects, IR bundles, environment specs and the files they name (each a Blob) | Packages are re-exported with the new SDK. A package from an older SDK fails with an error that says to re-export it. |
| **Stored state** — written by e3 as it runs and kept in a repository | datasets and their segment manifests, record states, commits and deltas, execution status, the dataflow's execution state and its events, unit plans, and the repository's own records: its repository record, package refs, workspace state, dataset refs, execution owners and plan pointers, the adoption memo, locks and run records | A repository an older e3 wrote is re-created: deployed again, and its data imported again. A reader refuses a stored object of another form, naming the fix. |

No reader keeps a decoder for an earlier form. Readers read the current form,
as writers write it, and every other form is an error that says what to do.

A PR that changes a wire says which kind it changes.

## Making a change

- **A struct gains or loses a field, or a variant a case:** change the type.
  Where the old bytes could decode as something else, the reader refuses them
  by what it can see, rather than misreading them.
- **A stored type that carries a version changes:** the dataflow's execution
  state (`EXECUTION_STATE_VERSION`) holds its events, so a new event changes it
  too. The version goes up by one, and the reader refuses any other version,
  naming it.
- **A local repository's records change** — one moves, is renamed, or takes
  another type: the layout version its repository record carries
  (`REPOSITORY_LAYOUT`) goes up by one. Opening a repository of any other
  layout, or with no repository record, refuses it before anything in it is
  read, naming the fix.
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
