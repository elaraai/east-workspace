# Composable content addressing for beast2 v5 objects

## The problem

e3 addresses an object by the SHA-256 of its bytes (`e3-core/src/objects.ts`,
`computeHash`). Every write path holds the bytes, so this is normally free.

Carve and splice break that assumption. `carveBeast2` / `spliceBeast2` (and
their streaming siblings in `execution/partitionIo.ts`) are **pure byte
operations**: they copy beast2 v5 segment frames verbatim under a shared
header and rebuild a small tail. Nothing about them needs to decode, or even
look at, the frame bytes. Yet today the result must be hashed end to end
before it can be named — so partitioned execution re-reads and re-writes every
byte through the orchestrator, and a cloud backend cannot let object storage
compose the result server-side (an S3 multipart upload built from
`UploadPartCopy` ranges) because nothing would ever observe the digest.

Asking the storage layer for the digest does not rescue it. S3's multipart
checksums are *composite* — a digest over the parts' digests, `-N` suffixed —
and its full-object checksum mode is a CRC-family feature. This is not an
oversight: CRC has a composition law (`crc(A‖B)` follows from `crc(A)`,
`crc(B)`, `len(B)`), and a cryptographic hash is *designed* so that no such
law exists. "Compose bytes I never read, but still know the digest" asks
SHA-256 for precisely the structure it was built not to have.

> The exact set of algorithms S3 admits for `ChecksumType: FULL_OBJECT` should
> be confirmed against current AWS documentation before it is quoted as fact
> anywhere load-bearing. It is context here, not a dependency: the design
> below never asks S3 for a digest.

## The scheme

Decompose a blob into **structural leaves** and hash the leaf digests:

```
leaves(blob) = [ blob[0, prefixEnd) ]                    header sections + root tag frame
             + [ blob[offsets[i], segEnd(i)) for each i ] one leaf per segment frame
             + [ blob[segmentsEnd, size) ]                terminator + index + footer

address(blob) = "seg1:" + SHA256( DOMAIN ‖ u32be(leafCount) ‖ H(leaf₀) ‖ … ‖ H(leafₙ) )
```

A blob with no index, or a non-collection root, is a single leaf holding the
whole blob — so the address is total over everything the store can hold.

Implementation: `e3-core/src/storage/composable-address.ts`.
Proof: `e3-core/src/storage/composable-address.spec.ts`.

### Why it still is content addressing

- **It commits to every byte.** The leaves *tile* the blob — no gaps, no
  overlaps — so no byte can change without changing a leaf digest. Asserted
  for every collection root kind, plus a single-byte sensitivity sweep.
- **It is a pure function of the bytes.** The decomposition is read off the
  blob's own trailing index, so `address` takes only the byte string.
- **Dedup is preserved exactly where it exists today.** Identical bytes ⇒
  identical segmentation ⇒ identical address. Two encodings of one value at
  different batch sizes get different addresses — but they already produce
  different bytes, so a flat SHA-256 separates them too. No regression.

### Why the leaves must be frame-aligned

A carve shifts every frame by `prefixEnd - offsets[from]`, which is not a
multiple of any fixed chunk size. Fixed-size chunking (BLAKE3-style 1 KiB
chunks, or 64 KiB, or 1 MiB) therefore misaligns under carve and composes
nothing; content-defined chunking has the same problem at the run's edges.
Only *structure-defined* leaves survive the shift, and beast2 v5 already gives
us the structure: self-contained segments at byte offsets the index names.

The spec asserts the misalignment directly, at three chunk sizes.

## What composes

| Operation | Address computable from | Frame bytes read |
|---|---|---|
| `carveBeast2(src, from, to)` | src's side-car | 0 |
| `spliceBeast2(parts)` | parts' side-cars | 0 |
| carve of a carve | derived side-car (no source access) | 0 |

The tail is the only thing hashed at composition time, and it is built from
the segment index alone by `spliceBeast2Tail` — no reads. The spec asserts
the carved tail is byte-identical to that function's output.

### The side-car

```ts
interface ObjectDigests {
  headDigest, head, prefixEnd, segmentsEnd, offsets, counts, frameDigests
}
```

Deliberately holds **no frame bytes**, so an address built from one is
structurally incapable of having read the frames it names. The spec composes
from a side-car round-tripped through its serialization to demonstrate this.

Computing a side-car reads the object once — free at write time, when the
bytes are streaming through anyway.

## Measured cost

From the spec's fixtures and a 400k-row default-encoded blob:

| | |
|---|---|
| serialized side-car | **40 bytes per segment** (32 digest + 4 offset + 4 count) |
| default segmentation | 1000 elements *or* 2 MiB, whichever first |
| 400k narrow rows → | 4.8 MB blob, 400 segments, ~12 KB mean frame |
| side-car overhead | **0.27 % of blob** at that shape |
| composing a 3-way splice of it | **0 of 4,806,587 frame bytes read** |

Two things this measurement changed:

1. **Overhead is ~0.27 %, not ~0.0015 %.** The binding constraint at default
   settings is the 1000-element batch cap, not the 2 MiB byte target — narrow
   rows hit the element cap long before the byte cap. Wide rows approach the
   byte target and the overhead falls accordingly, but 0.27 % is the number to
   plan with.
2. **The side-car cannot live in a DynamoDB catalogue attribute.** At 40 bytes
   per segment a 400 KB item holds fewer than 11k segments — about 130 MB of
   object at the measured shape. Large objects overflow it. The side-car
   belongs in object storage beside the blob, or in the container itself.

## Open decisions

### Where the digests live

- **Beside the object** (e.g. `{repo}/objects/{hash}.digests`) — no wire
  change, no runtime coordination, one extra immutable GET to compose. But it
  is per-backend derived data: an object crossing backends (export/import, the
  rack bridge) either carries it or has it recomputed on first use, which is a
  one-time full read.
- **In the container** — extend the v5 index section to carry a digest per
  segment. Self-describing, travels with the value, nothing to recompute.
  Costs a wire version bump: `readIndex` rejects unknown flag bits
  (`beast2/v5/codec.ts`), and the spec forbids trailing bytes after the
  footer, so there is no compatible slot.

**These are cheaper together than apart.** Changing the address function
re-keys every stored object; so does a container bump. Doing both in one
release spends one flag day instead of two — which argues for the in-container
form if we are confident in the leaf definition.

### Migration

Prefix addresses by scheme (`sha256:…` vs `seg1:…`, the multihash
convention). Old objects stay readable at their existing keys, new writes use
the new scheme, and ref trees holding old addresses keep resolving. This is
the v4→v5 situation — cache invalidation, not corruption — not a data
migration.

### Still to design

- **`ObjectStore` shape.** An optional `segmentDigests?()` / `composeFrom?()`
  pair, in the dependency-injection style the storage interfaces already use,
  with an in-memory implementation for tests. Deliberately not attempted here.
- **A frame-aware streaming digester.** A runner writing a task output through
  `writeStream` needs per-frame digests without buffering. The composition
  path does not — a composer already knows the segment layout it is building —
  but the plain write path does.
- **What verification looks like.** A flat SHA-256 lets any dumb client stream
  bytes and check them, including a browser on a presigned URL. Under this
  scheme a verifier must parse the index and hash per frame. That is the real
  trade: **dumb verification for free composition.**
- **Merkle rather than a flat vector.** Same build cost, and it buys something
  new: a paged reader could verify ONE segment against the address with a
  log-sized proof, instead of trusting an unverified window. Prototyped and
  asserted during design; not carried into the module, pending the decision
  above.
