# BEAST2 wire version policy

The beast2 container version is a **platform-wide constant**, not a per-runtime
or per-call-site choice. This document says where it is declared, what
guarantees it carries, and how the tests are arranged so that neither the
guarantee nor its absence is discovered by accident.

## Where it is declared

| Runtime | Constant | File |
|---|---|---|
| TypeScript | `BEAST2_WRITE_VERSION` / `BEAST2_READ_VERSIONS` | `libs/east/src/serialization/beast2/version.ts` |
| C | `EAST_BEAST2_WRITE_VERSION` | `libs/east-c/packages/east-c/include/east/serialization.h` |
| Python | — inherits the C constant through the bridge | `libs/east-py` has no encoder of its own |

`scripts/check-wire-compat.mjs` fails the build if the TypeScript and C
constants disagree. It runs inside `make check-version`, which
`version-drift.yml` executes on every PR, and it is hermetic — no network, no
registry lookup.

**The two must move together.** The compliance suite pins one golden byte
string per value and replays it in TypeScript, east-c and east-py alike, so a
one-sided change desyncs every shared fixture — surfacing as dozens of
unrelated-looking byte mismatches rather than as "the wire format changed in
one runtime".

## What is guaranteed

- **Readers accept every released container, indefinitely.** All decode entry
  points dispatch on the magic's version byte, so no consumer names a version
  to read. `BEAST2_READ_VERSIONS` only ever grows.
- **Writers emit exactly `BEAST2_WRITE_VERSION`.** Explicit escape hatches
  exist for pinning an older container — `encodeBeast2For(t, { version: 4 })`
  in TypeScript, `east_beast2_encode_v4()` in C,
  `encode_beast2_with_header_for(T, version=4)` in Python.

## What is NOT guaranteed

**An older runtime is not expected to decode a newer runtime's bytes.** The
stance is lockstep upgrade, recorded in
`libs/e3/design/e3-environment-granularity.md`. Bumping
`BEAST2_WRITE_VERSION` therefore means: any consumer pinned to a previous
release cannot read the new output until it is upgraded. Since e3
content-addresses beast2 bytes, a bump also re-keys every stored object —
cache invalidation, not corruption.

**Bytes that were never the encoding of any East value.** The
reader-accepts-every-released-container promise covers valid encodings, not
the output of writer bugs. When a writer defect let bytes ship that no East
value canonicalizes to — the v5 case: Set/Dict segment content in a plain
JS container's insertion order rather than East total order, which also made
one logical value hash to different content addresses — those blobs are
carved out as corruption. Readers reject them (v5 readers validate strict
key ascent and segment disjointness), the writer bug is fixed in the same
release, and re-encoding the value from any runtime container yields
canonical bytes. There is no tolerant window for such blobs: keeping a
repair path alive would preserve the ambiguity the fix exists to remove.

## How the tests are arranged

This bit matters, because it was wrong for a long time and the failure was
silent.

`libs/e3/test/integration/src/environment-e2e.spec.ts` materializes an
execution environment from a scaffolded project's lockfile. The scaffold pins
`@elaraai/*` to the workspace version — which, because the release workflow
pushes the version bump to `main`, is *always the version already published*.
Left alone, that environment therefore contained **the previous release's**
runtime, and the suite quietly became a regression test for the last release:
anything this repo changed in the runtime was invisible until a release had
already shipped it, and the suite asserted an N-1 backward-compatibility
contract that this document explicitly declines to offer.

So:

- **`environment-e2e.spec.ts` uses a local stand-in registry**
  (`src/localStack.ts`) serving this tree's build — a flat uv index of
  locally-built wheels for python, a small out-of-process npm registry for
  node. The property it proves is *transport of first-party project code*
  (scaffold → export → delete the project → import → deploy → run), which is
  what it was always for.
- **`released-runtime-compat.spec.ts` is the single place cross-version
  behaviour is asserted**, deliberately and narrowly.

Two mechanics worth knowing before touching `localStack.ts`:

1. e3 materializes python envs with
   `uv sync --frozen --all-packages --no-install-workspace --no-install-local`.
   `--no-install-local` skips every path/editable/directory source by design, so
   a `[tool.uv.sources] { path }` override is excluded from the env outright —
   and e3's capture then treats it as first-party code to vendor, breaking
   member resolution. A **named flat index** is classified by uv as a
   `registry` source instead, which installs normally and is invisible to the
   capture closure. That single classification difference is the whole trick.
2. The stand-in npm registry runs in **its own process**. The suite drives
   npm/uv through `execFileSync`, which blocks the event loop, so an in-process
   server cannot answer the very install that is blocking it.
