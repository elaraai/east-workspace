# Wire migration rule

Every value e3 persists or ships is a beast2 value of a declared East type. A
struct's fields encode by position, so changing a type changes its wire: bytes
written under the old type do not decode under the new one. This document says
which kind of change gets which migration, so that no change picks its own.
The beast2 container itself is governed by
[`BEAST2_WIRE_VERSION.md`](./BEAST2_WIRE_VERSION.md).

## Two kinds of wire

| Kind | Examples | Rule |
|---|---|---|
| **Package-borne** — written by the SDK at export and carried in a package | task objects and their metadata, package objects, function objects, IR bundles | **Hard cutover.** Packages are re-exported with the new SDK. No read-compat decoder is kept, and a package from an older SDK fails with an error that says to re-export it. |
| **Stored state** — written by e3 as it runs and kept in a repository | datasets (blobs and segment manifests), record states, commits and deltas, execution status, the dataflow's execution state and its events, unit plans and partition plans | **Readers accept every released form, forever; writers write only the current one.** Each type has exactly one read-compat decoder, which tries the current shape and then each older shape, with a test per form. |

A PR that changes a wire says which kind it is and follows the rule for that
kind.

## Making a change

- **A stored struct gains a field:** add the old shape to that type's one
  read-compat decoder, with a test that decodes bytes written under it. Never add
  a second decoder beside the first.
- **A stored variant gains or loses a case:** treat it like a struct change.
  Released readers cannot decode a case they do not know, which is the lockstep
  upgrade the container already has.
- **A stored type that carries a version changes:** the dataflow's execution
  state (`EXECUTION_STATE_VERSION`) holds its events, so a new event changes it
  too. The version goes up by one, and the type's read-compat decoder keeps a
  decoder for each older version. It tells them apart by the type the stored
  header declares, upgrades an older state to the current version, and refuses
  a newer one, naming its version. A test pins each version by decoding a state
  that version wrote.
- **A package-borne type changes:** change it and re-export. Any read-compat
  decoder the type still carries goes in the same change. The package,
  function, record and mutation objects carry such decoders today, and lose
  them at their next change.
- **A new object kind names other objects:** it carries a `kind` tag, and lands
  with a GC test. GC dispatches a tagged object on its tag, through a table
  listing the field names of every released version of each kind, so a new
  version of a kind is one more entry there, with its test. An object without
  a tag GC recognizes by its shape. Either way GC is a reader of every such
  wire.

## Frozen wires

These cannot change without breaking released readers. A change to one is a
new version of the thing, not an edit to it.

- **The beast2 container:** its magic, its frame format and its index. Readers
  refuse index flag bits they do not know, so a new flag is a new container
  version.
- **The beast2 well-known type registry:** its ids are pinned.
- **The segment manifest** (`$segments`): readers recognize it by its exact
  field set, so a changed struct is a different object to every released reader.
