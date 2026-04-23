# East Snapshot Format (`.east-snapshot`)

A snapshot bundles everything needed to re-run a single East program invocation
(IR + inputs + platform package references) into one portable file. All three
runtime CLIs (`east-c`, `east-node`, `east-py`) read and write the same format.

## Purpose

When a program crashes or produces an unexpected result, the user wants a
single file they can hand to a developer (or re-run later) that perfectly
reproduces the invocation. The format deliberately captures **inputs, not
outputs** — the output is whatever re-running produces.

## File layout

A snapshot is an **uncompressed POSIX tar archive** (ustar format). Consumers
can inspect it with `tar tf foo.east-snapshot`. Entries:

| Entry             | Required | Description |
|-------------------|----------|-------------|
| `manifest.json`   | yes      | east-JSON of `SnapshotManifestType` (schema below). First entry in the archive. |
| `ir.<ext>`        | yes      | The function IR, byte-for-byte copy of the original file. `<ext>` ∈ {`beast2`, `beast`, `east`, `json`}. |
| `input-<N>.<ext>` | 0..n     | Input value `N`, byte-for-byte copy of the original file, in positional order. `N` starts at 0. |

Payload files (IR + inputs) are copied **verbatim** from whatever format the
user passed on the command line. The manifest is the only thing written fresh.

## Manifest (`manifest.json`)

The manifest is **east-JSON** of a single East value whose type is
`SnapshotManifestType`, defined in East as:

```ts
const SnapshotManifestType = StructType({
  version:    IntegerType,                 // bumped on breaking layout changes; current: 1
  created_at: DateTimeType,                // UTC
  runtime: StructType({
    impl:    StringType,                   // "east-c" | "east-node" | "east-py"
    cli:     StringType,                   // e.g. "east-c 0.6.2"
  }),
  ir:       StringType,                    // archive filename, e.g. "ir.beast2"
  inputs:   ArrayType(StringType),         // ordered archive filenames, [] if no inputs
  packages: ArrayType(StringType),         // names to pass to -p on replay
});
```

Writers construct a value of this type and emit it using the runtime's
existing east-JSON encoder. Readers do the symmetric thing with the decoder.
**No ad-hoc JSON parsing in any CLI** — the existing type-directed
encode/decode handles it.

Each runtime holds its own copy of the type definition (three short lines of
code); a compatibility test (see below) ensures they stay aligned.

## CLI contract

Every runtime CLI exposes two flags on the `run` subcommand:

```bash
# Write a snapshot while running (captures IR + all inputs before execution).
<cli> run <ir> [-p PKG]... [-i FILE]... --snapshot <path.east-snapshot>

# Replay from a snapshot (no other args required).
<cli> run --from-snapshot <path.east-snapshot> [-o OUT] [-v]
```

Rules:

1. **Write-before-execute.** The writer MUST flush the snapshot to disk before
   invoking the runtime, so crashes during execution still leave the snapshot
   behind.
2. **`--from-snapshot` is exclusive** — cannot be combined with `<ir>`, `-i`,
   or `-p`. The snapshot itself supplies all of those.
3. **Unknown packages on replay** error out just like `-p <unknown>` would on
   a normal `run` — no special behavior.
4. **Extension.** Writers SHOULD use `.east-snapshot`. Readers SHOULD NOT
   require any particular extension (detect by tar magic + manifest presence).

## Round-trip invariant

For any valid invocation:

```bash
<cli> run A.ir -i X -i Y -p std -o out.beast2 --snapshot snap.east-snapshot
```

the following produces output bit-identical to `out.beast2`:

```bash
<cli> run --from-snapshot snap.east-snapshot -o out2.beast2
```

Across CLIs: a snapshot written by one CLI replays correctly on any other CLI
that implements all listed `packages` — this is how a developer on east-c can
reproduce a bug filed from east-node, or vice versa.

## Compatibility test

A smoke test lives in `libs/east-c/tests/snapshot_roundtrip.sh` (and sibling
tests in each lib) that:

1. Runs a small program with `--snapshot`.
2. Replays it with `--from-snapshot` on the **same** CLI and diffs output.
3. Replays it on each **other** CLI and diffs output.

Any drift in the manifest schema across implementations fails step 3.
