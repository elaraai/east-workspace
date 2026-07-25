# Beast2 container — version dispatch

Beast2 is a family of binary containers for East values sharing one magic
prefix. The 8th magic byte is the container version; every decode entry point
dispatches on it, so callers never name a version to read.

## Magic registry

```
0x89 "East" 0x0D 0x0A <version>
```

| Byte | Container | Status | Spec |
|---|---|---|---|
| `0x02` | v2 — type table + string table | superseded (no decoder in tree) | `devdocs/BEAST2.md` (historical) |
| `0x04` | v4 — globally sectioned (type/string/source-map/value tables) | decoded indefinitely; written on request (`version: 4`) | [`v4/SPEC.md`](v4/SPEC.md) |
| `0x05` | v5 — segment-terminated record stream, per-segment compression, optional paging index | **current default write format**; decoded everywhere | [`v5/SPEC.md`](v5/SPEC.md) |
| `0x43` | chunked container (`'C'`) | reserved — prototype superseded by v5 before release (PR #415) | — |
| `0xF5` | v5 **footer** magic (end of blob, not a container version) | — | [`v5/SPEC.md`](v5/SPEC.md) |

Unknown version bytes fail with `Unknown Beast2 version: 0x..` (the prefix
check and the version check are distinct errors in every runtime).

## Version policy

- **Decoders accept every released version, indefinitely.** All entry points
  (`decodeBeast2For`, `decodeBeast2`, `decodeEastIR`, the C
  `east_beast2_decode_*` family, the east-py bridge) sniff the magic and
  dispatch — no consumer call-site names a version to read.
- **Encoders write v5 by default** (deflate-framed, no trailing index), since
  issue #416 phase 2. v4 is opt-in per encode, and every runtime carries the
  same escape hatch: `encodeBeast2For(t, { version: 4 })` in TS,
  `east_beast2_encode_v4()` in C, `encode_beast2_with_header_for(T, version=4)`
  in Python. Every runtime's default moved in the same
  release: the compliance suite pins one golden byte string per value and runs
  it in TS, east-c and east-py, so the defaults cannot drift apart.
- **The flip changed every e3 object hash.** e3 content-addresses beast2 bytes
  (SHA-256 of the blob), so the same logical value now lands under a different
  hash than it did before this release — cache invalidation, not corruption.
- The v4 write path is retained at least until one release after this one.

## Layout

```
beast2/
  index.ts       version-agnostic public API + magic dispatch
  shared.ts      format-neutral pieces (decode options, IR singleton,
                 decoded-function compile glue)
  SPEC.md        this file — magic registry + version policy
  v4/            the v4 codec + v4/SPEC.md
  v5/            the v5 codec + v5/SPEC.md
```

The C implementation mirrors this layout under
`libs/east-c/packages/east-c/src/serialization/beast2/` (`full.c` dispatches,
`v4/` and `v5/` hold the codecs). east-py bridges to the C implementation and
adds the Python streaming APIs.
