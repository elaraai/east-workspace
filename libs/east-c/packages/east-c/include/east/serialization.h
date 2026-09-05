#ifndef EAST_SERIALIZATION_H
#define EAST_SERIALIZATION_H

#include "types.h"
#include "values.h"
#include "ir.h"
#include "type_of_type.h"
#include <stddef.h>
#include <stdint.h>

// JSON serialization
char *east_json_encode(EastValue *value, EastType *type);
EastValue *east_json_decode(const char *json, EastType *type);
// JSON decode with detailed error message (caller frees *error_out on failure)
EastValue *east_json_decode_with_error(const char *json, EastType *type, char **error_out);

/* ------------------------------------------------------------------ */
/*  Strict streaming JSON reader                                       */
/* ------------------------------------------------------------------ */
/*
 * A pull reader over a document too large to decode whole. It constructs one
 * value at a time against the East type and never materialises the document,
 * so a caller that maps a file reads it at whatever residency the kernel
 * chooses rather than on the heap.
 *
 * STRICT: it accepts exactly what `jsonSchemaFor(T)` describes — what the
 * ENCODER emits — rather than what `east_json_decode` tolerates. An integer
 * must be a quoted decimal in i64 range with no leading zeros and no sign on
 * zero; a timestamp must carry an explicit `+00:00`, not `Z` and not a numeric
 * offset; a blob's hex must be lowercase. Every runtime refuses the same
 * documents with the same message, which is what makes a published contract
 * enforceable wherever it is read.
 *
 * The reader BORROWS `data`: the caller keeps the bytes alive and unchanged
 * until east_json_reader_free.
 */
typedef struct EastJsonReader EastJsonReader;

/* Opens a document and descends to the RFC 6901 pointer ("" is the whole
 * document). With `enter`, steps inside the array or object named there and
 * prepares to iterate it; without, stops in front of the value so it can be
 * read whole. NULL on failure, with an allocated message in *error_out. */
EastJsonReader *east_json_reader_open(const char *data, size_t len, const char *pointer, bool enter,
                                      char **error_out);

/* Whether the container has another element. A predicate: it consumes the
 * closing bracket once nothing is left and otherwise leaves the cursor alone,
 * so it need not alternate with east_json_reader_next. */
bool east_json_reader_more(EastJsonReader *r);

/* Reads the next element as `type`. For an object container `type` must be a
 * Struct of exactly `key` and `value`. NULL on failure with *error_out set. */
EastValue *east_json_reader_next(EastJsonReader *r, EastType *type, char **error_out);

/* Reads one whole value as `type`, for a reader opened with enter=false. */
EastValue *east_json_reader_read(EastJsonReader *r, EastType *type, char **error_out);

void east_json_reader_free(EastJsonReader *r);

// Byte buffer for binary serialization
typedef struct {
    uint8_t *data;
    size_t len;
    size_t cap;
} ByteBuffer;

ByteBuffer *byte_buffer_new(size_t initial_cap);
void byte_buffer_free(ByteBuffer *buf);
void byte_buffer_write_u8(ByteBuffer *buf, uint8_t val);
void byte_buffer_write_bytes(ByteBuffer *buf, const uint8_t *data, size_t len);

// BEAST2 binary serialization (headerless, type-driven)
ByteBuffer *east_beast2_encode(EastValue *value, EastType *type);
EastValue *east_beast2_decode(const uint8_t *data, size_t len, EastType *type);

// The container version this build's encoders write by default. Kept in
// lockstep with BEAST2_WRITE_VERSION in
// libs/east/src/serialization/beast2/version.ts -- scripts/check-wire-compat.mjs
// (via `make check-version`) fails the build if the two disagree, because the
// compliance suite pins ONE golden byte string per value and replays it in
// TypeScript, east-c and east-py alike.
#define EAST_BEAST2_WRITE_VERSION 5

// BEAST2 with header (magic bytes + type schema + value). Writes
// EAST_BEAST2_WRITE_VERSION; see east_beast2_encode_v4 / east_beast2_encode_v5
// below to pin a container explicitly.
ByteBuffer *east_beast2_encode_full(EastValue *value, EastType *type);
EastValue *east_beast2_decode_full(const uint8_t *data, size_t len, EastType *type);
// Frozen (task-input) decode: every constructed container, Ref, Vector and
// Matrix carries the frozen flag from construction (inherited by nested
// allocations, no post-walk) — the mutating builtins refuse them with
// EAST_FROZEN_MUTATION_MSG and frozen collections compare as value types
// under Is. Function values and their captures stay mutable (a closure owns
// its own state).
EastValue *east_beast2_decode_full_frozen(const uint8_t *data, size_t len, EastType *type);
// Purge the type-table section skip-cache (#417). Called by
// east_type_registry_clear (cached tables retain arena-backed types); useful
// directly only in tests or before tearing down the runtime by other means.
void east_beast2_type_cache_clear(void);
// BEAST2-full decode using the embedded type schema (self-describing)
EastValue *east_beast2_decode_auto(const uint8_t *data, size_t len);
// Extract the type schema from beast2-full encoded data (returns retained EastType*)
EastType *east_beast2_extract_type(const uint8_t *data, size_t len);

// Why `data` is not a beast2 container, or NULL when its magic names a
// readable version — the diagnostics the TypeScript runtime gives
// ("Data too short for Beast2 format: N bytes", "Invalid Beast2 magic at
// offset i: expected 0x.., got 0x..", "Unknown Beast2 version: 0x.."),
// formatted into `buf`. The open paths post it under their own prefix.
const char *east_beast2_magic_problem(const uint8_t *data, size_t len, char *buf, size_t cap);

// Decode beast2-full IR and convert to IRNode in one shot.
// Keeps the type table alive across decode + IR conversion for O(1) type resolution.
// Returns NULL on failure. Caller must call ir_node_release on the result.
// ir_value_out (optional): if non-NULL, receives the retained IR EastValue* (for re-serialization).
// source_map_out (optional): if non-NULL, receives a heap EastSourceMap* holding one reference
//   for the caller (drop it with east_source_map_release; a compiled function given the map
//   takes its own reference — see EastCompiledFn). NULL when the blob carries no stacks, or
//   when the parameter is NULL (the decoded map is then discarded).
IRNode *east_beast2_decode_ir(const uint8_t *data, size_t len, EastValue **ir_value_out,
                              EastSourceMap **source_map_out);

// Whole-value v4 encode — the legacy globally-sectioned container, for a
// reader that predates v5. The escape hatch matching TypeScript's
// encodeBeast2For(type, { version: 4 }); decoding needs no such choice, since
// every entry point above sniffs the magic. Returns NULL on failure (message
// via east_builtin_get_error).
ByteBuffer *east_beast2_encode_v4(EastValue *value, EastType *type);

// ============================================================================
// BEAST2 v5 — segment-terminated record stream (issue #416).
// Every east_beast2_decode_* entry point above already accepts v5 blobs (the
// magic's version byte dispatches); the functions below are the v5-only
// writers and readers.
// ============================================================================

// v5 frame codecs
#define EAST_BEAST2_CODEC_NONE 0
#define EAST_BEAST2_CODEC_DEFLATE 1

// Whole-value v5 encode. codec_id compresses data-sized frames
// (EAST_BEAST2_CODEC_*); with_index appends the paging index + footer for
// Array/Set/Dict roots. Returns NULL on failure (message via
// east_builtin_get_error).
ByteBuffer *east_beast2_encode_v5(EastValue *value, EastType *type, int32_t codec_id,
                                  bool with_index);

// Paged whole-value v5 encode (the C mirror of TypeScript's
// encodeBeast2PagedFor): one Array/Set/Dict value in, a segmented,
// self-contained, INDEXED blob out. Batching is byte-adaptive — capped at
// 1,000 elements per segment AND adapted toward target_segment_bytes of wire
// output (0 = the 2 MiB default), seeded by a small probe and refined per
// flush — so wide rows still yield right-sized segments. Deterministic per
// value. Returns NULL on failure (message via east_builtin_get_error).
ByteBuffer *east_beast2_encode_paged(EastValue *value, EastType *type, int32_t codec_id,
                                     size_t target_segment_bytes);

// Streaming v5 writer: each write() encodes one batch (a value of the declared
// Array/Set/Dict type) as one root segment, so writer memory is O(batch).
// Output bytes accumulate internally; drain with take() (returns a ByteBuffer
// the caller frees, or NULL when nothing is pending). finish() appends the
// terminator (and index + footer unless disabled). self_contained scopes
// aliasing per segment so the output is pageable (the default for paging).
typedef struct Beast2StreamWriter Beast2StreamWriter;
Beast2StreamWriter *east_beast2_writer_new(EastType *type, int32_t codec_id, bool self_contained,
                                           bool with_index);
bool east_beast2_writer_write(Beast2StreamWriter *w, EastValue *batch);
ByteBuffer *east_beast2_writer_take(Beast2StreamWriter *w);
bool east_beast2_writer_finish(Beast2StreamWriter *w);
void east_beast2_writer_free(Beast2StreamWriter *w);

// Sequential v5 segment reader over a complete blob (the caller keeps `data`
// alive and unchanged for the reader's lifetime). next() returns one decoded
// collection per root segment (caller releases), NULL when done or on error —
// distinguish with done(). counts() reports the trailing index's totals when
// present (returns false for index-less blobs).
typedef struct Beast2SegmentReader Beast2SegmentReader;
Beast2SegmentReader *east_beast2_reader_new(const uint8_t *data, size_t len, EastType *type);
EastValue *east_beast2_reader_next(Beast2SegmentReader *r);
bool east_beast2_reader_done(Beast2SegmentReader *r);
bool east_beast2_reader_counts(Beast2SegmentReader *r, size_t *segment_count,
                               size_t *element_count);
void east_beast2_reader_free(Beast2SegmentReader *r);

// Random access over an indexed, self-contained v5 collection blob (the caller
// keeps `data` alive and unchanged for the pages object's lifetime). new()
// parses the header + trailing index once, so counts are O(1); it fails when
// the blob carries no index. segment() seeks to and decodes exactly ONE segment
// (caller releases the returned collection) and additionally requires
// self-contained segments — self_contained() reports the flag either way.
// element() addresses Array roots only: it binary-searches the index and
// decodes just the owning segment. Both return NULL on failure (message via
// east_builtin_get_error). counts() borrows the per-segment element (pair)
// counts, valid until free().
typedef struct Beast2Pages Beast2Pages;
Beast2Pages *east_beast2_pages_new(const uint8_t *data, size_t len, EastType *type);
size_t east_beast2_pages_segment_count(Beast2Pages *p);
size_t east_beast2_pages_element_count(Beast2Pages *p);
bool east_beast2_pages_self_contained(Beast2Pages *p);
const size_t *east_beast2_pages_counts(Beast2Pages *p, size_t *n_out);
// What paging has cost so far: the segments and fences actually decoded —
// a cache hit (segment or fence) is not counted again.
// A runner reports these per lazy input — the account residency cannot give
// on a mapping, where the kernel decides how much of a touched file is resident.
void east_beast2_pages_stats(Beast2Pages *p, size_t *segments_decoded, size_t *fences_probed);
EastValue *east_beast2_pages_segment(Beast2Pages *p, size_t i);
EastValue *east_beast2_pages_element(Beast2Pages *p, size_t row);
// Segment i's FENCE: its first element (Array/Set) or first key (Dict),
// decoded from a bounded inflate of the frame's prefix and cached — the
// microsecond probe behind keyed lookups (#481 W2). Requires self-contained
// segments. Returns a retained value or NULL (message via
// east_builtin_get_error).
EastValue *east_beast2_pages_fence(Beast2Pages *p, size_t i);
// Keyed reads over Set/Dict roots (#481 W2): a binary search over the fences
// picks the owning segment, that one segment decodes through a small LRU
// shared with element(), and the in-segment lookup answers. Requires the
// key-disjoint segments sorted-order writers produce: the first keyed read
// verifies the fences ascend strictly, and every decoded segment's greatest
// key is checked against the next fence — violations post "segments are not
// key-disjoint". get_key returns 1 found (Dict: *value_out retained; Set:
// membership only), 0 not found, -1 error.
int east_beast2_pages_get_key(Beast2Pages *p, EastValue *key, EastValue **value_out);
// Batched Dict lookup: keys is a Set of the root's key type, walked in one
// forward merge against the fences so each owning segment decodes once.
// Returns a retained Dict of the found pairs, and via *missing_out (retained)
// the Set of keys not present; NULL on failure.
EastValue *east_beast2_pages_get_keys(Beast2Pages *p, EastValue *keys, EastValue **missing_out);
// GLOBAL insertion index over a sorted Array root: last=false is the leftmost
// position of an equal element, last=true just past the rightmost — the
// fences pick the boundary segment, its in-segment binary search adds the
// base. Sortedness is the caller's contract, as in the eager builtins.
bool east_beast2_pages_find_sorted(Beast2Pages *p, EastValue *target, bool last, size_t *index_out);
// Segment i for the streamed compute family over Set/Dict roots (#481 W4):
// the same disjointness contract as the keyed reads — fences verified
// strictly ascending on first use, the segment decoded through the shared
// LRU, and its greatest key checked against the next fence — so a
// cross-segment fold sees exactly the key-disjoint stream a whole-value
// decode would produce. Returns a retained value or NULL (message via
// east_builtin_get_error).
EastValue *east_beast2_pages_segment_disjoint(Beast2Pages *p, size_t i);
void east_beast2_pages_free(Beast2Pages *p);
// The pager's root collection type (borrowed — owned by the pager).
EastType *east_beast2_pages_type(Beast2Pages *p);

// ============================================================================
// BEAST2 v5 column projection (issue #599, finishing #481 W3).
// A Beast2Projection is a validated plan from the WIRE type to a subset
// PROJECTED type: struct fields subset by name at any depth (skipped fields
// are parsed-and-hopped, never materialized); variant case lists must match
// exactly though payloads may project; Dict keys and Set elements must be
// identical (they order the container); primitives/Vector/Matrix/functions
// must be identical. Zero wire change — the same blob decodes whole or
// projected. Validation failures post an error naming the offending field
// and the wire type's fields.
// ============================================================================
typedef struct Beast2Projection Beast2Projection;
// Build + validate a plan. Returns NULL with the validation error posted.
Beast2Projection *east_beast2_projection_new(EastType *wire, EastType *proj);
void east_beast2_projection_free(Beast2Projection *pr);
// The plan's endpoint types (borrowed — owned by the projection).
EastType *east_beast2_projection_wire_type(Beast2Projection *pr);
EastType *east_beast2_projection_root_type(Beast2Projection *pr);
// Whether the plan is a no-op (projected type deep-equals the wire type).
bool east_beast2_projection_is_identity(Beast2Projection *pr);
// One segment decoded through `pr`, bypassing the pager's shared cache — a
// segment decoded under one mask is never served to an operation needing a
// wider one. A REF crossing the projection boundary (a container aliased
// from a projected-away field) fails with a "beast2 v5 projection alias"
// error; retry with east_beast2_pages_segment for the whole decode.
EastValue *east_beast2_pages_segment_projected(Beast2Pages *p, size_t i,
                                               const Beast2Projection *pr);
// The disjointness-checked sibling for Set/Dict roots (fences verify on
// wire-shaped keys; the decode itself is projected and uncached).
EastValue *east_beast2_pages_segment_disjoint_projected(Beast2Pages *p, size_t i,
                                                        const Beast2Projection *pr);
// Open-time projection: EVERY pager read (segment(), element(), keyed gets,
// the shared cache) decodes through `pr` from now on — the cache stays
// consistent because the pager's shape is fixed for its lifetime. `pr` is
// borrowed (caller keeps it alive for the pager's lifetime); NULL clears.
// The decoded-segment cache is dropped on every change. find_sorted refuses
// under a projection (the file is sorted by whole elements).
void east_beast2_pages_set_projection(Beast2Pages *p, const Beast2Projection *pr);
// Sequential-reader sibling; must be called before the first next().
void east_beast2_reader_set_projection(Beast2SegmentReader *r, const Beast2Projection *pr);
// Derive a projection for a paged for-loop from the loop BODY's IR: the mask
// is the set of GetField paths the body reaches from `target` (the loop's
// element/value variable). Returns NULL — decode whole — when the variable
// escapes a field read, a binder shadows it, the row is not a struct, every
// field is read, or the plan refuses (a skipped function field). The caller
// owns a non-NULL result (east_beast2_projection_free).
Beast2Projection *east_beast2_projection_for_loop(const IRNode *body, const char *target,
                                                  EastType *root_type);
// Thread-local segment counters for the paged-loop seam (task inputs): how
// many segments decoded projected vs whole. Surfaced through eager_stats().
void east_beast2_paged_loop_count(bool projected);
void east_beast2_paged_loop_stats(size_t *projected, size_t *whole);

// Lazy pager-backed collection value (issue #505): wraps an indexed,
// self-contained v5 blob as an EAST_VAL_PAGED value whose size, keyed reads
// and for-loop iteration answer from the pager, and whose every other
// operation hydrates once and delegates. Takes ownership of `data`
// (free()-compatible) ON SUCCESS; on NULL (no index, aliased segments, or a
// malformed container — message via east_builtin_get_error) the caller keeps
// ownership. `type` must be the blob's Array/Set/Dict decode type.
EastValue *east_beast2_open_paged(uint8_t *data, size_t len, EastType *type);

// Frozen lazy open (issue #539): the paged value and every pager-served
// segment decode frozen, so mutation refuses and the collection is a value
// type under Is. Because frozen values cannot be mutated, the shape gate
// collapses — any Array/Set/Dict element shape opens lazily except those
// carrying a Ref (an identity cell) or function values (captured state),
// which still fall back to the eager frozen decode.
EastValue *east_beast2_open_paged_frozen(uint8_t *data, size_t len, EastType *type);

// Borrowed-bytes lazy open (issue #560): like east_beast2_open_paged(_frozen),
// but the blob bytes are BORROWED — the caller keeps them alive and unchanged
// (an mmap'd file) for the value's whole lifetime, and nothing is freed on
// release. Never takes ownership, success or failure.
EastValue *east_beast2_open_paged_view(const uint8_t *data, size_t len, EastType *type,
                                       bool frozen);

// Owned-bytes lazy open (issue #658): `data` aliases bytes that `owner` (a
// Blob value, typically) keeps alive — the paged value RETAINS `owner` for
// its whole lifetime and releases it after its pager, so the bytes outlive
// every read. Never frees `data` itself. Returns NULL (owner not retained)
// when the blob is not pageable or the element shape is gated, exactly like
// east_beast2_open_paged; the caller then decodes whole.
EastValue *east_beast2_open_paged_owned(EastValue *owner, const uint8_t *data, size_t len,
                                        EastType *type, bool frozen);

// Host-released lazy open (issue #658): the bytes belong to the host (an
// mmap, a foreign buffer) and `release(ctx, data, len)` is invoked EXACTLY
// ONCE, after the pager is freed, when the value dies — on the refcount
// path and under the cycle collector alike. On NULL (not pageable, gated
// shape, malformed container) the callback never fires and the bytes stay
// the caller's, matching east_beast2_open_paged's ownership rule. The hook
// may run inside the collector's destroy phase, so it must only release
// what it owns (munmap, free, a Py_DECREF) and never re-enter the runtime.
EastValue *east_beast2_open_paged_external(uint8_t *data, size_t len, EastType *type, bool frozen,
                                           void (*release)(void *ctx, uint8_t *data, size_t len),
                                           void *ctx);

// The byte budget of a pager's decoded-segment cache (issue #560): the sum of
// cached segments' decompressed frame lengths stays at or under the budget
// (the newest segment always caches, even alone over it). Defaults to 64 MiB;
// the EAST_PAGED_CACHE_BYTES environment variable overrides it at open.
void east_beast2_pages_set_cache_budget(Beast2Pages *p, size_t bytes);

// The eager collection behind a paged value, decoding the whole blob on
// first use (cached on the wrapper; iteration locks carry over). Returns a
// BORROWED value kept alive by `v` — retain to keep it past `v` — or NULL on
// decode failure (message via east_builtin_get_error). Non-paged values pass
// through unchanged, so call sites can unpage unconditionally.
EastValue *east_paged_hydrated(EastValue *v);

// Byte extents of an indexed v5 collection blob, for splicing (issue #484):
// everything a host needs to byte-copy the blob's segment frames into a merged
// stream without decoding a value. All offsets are wire offsets; offsets and
// counts are owned by the struct (free with east_beast2_splice_extents_free).
// self_contained / source_map_empty report the blob's flags rather than
// failing, so the host can name the offending file in its own error.
typedef struct {
    size_t prefix_end;   /* end of header + root NEW tag frame = first segment frame */
    size_t segments_end; /* end of the last segment frame = terminator frame start */
    size_t index_offset; /* wire offset of the index section */
    size_t *offsets;     /* per-segment frame offsets */
    size_t *counts;      /* per-segment element (pair) counts */
    size_t segment_count;
    bool self_contained;
    bool source_map_empty; /* the header source map carries no stacks */
} Beast2SpliceExtents;

// Parse the extents of one indexed v5 blob. Returns NULL on failure (message
// via east_builtin_get_error): not a v5 container, no trailing index, or
// malformed/misplaced sections. Never decodes a value.
Beast2SpliceExtents *east_beast2_splice_extents(const uint8_t *data, size_t len);
void east_beast2_splice_extents_free(Beast2SpliceExtents *e);

// The bytes that terminate a spliced stream whose segment frames end at wire
// offset `stream_end`: terminator frame + self-contained index for the given
// segment table + footer. Returns a ByteBuffer the caller frees, or NULL on
// allocation failure.
ByteBuffer *east_beast2_splice_tail(const size_t *offsets, const size_t *counts, size_t n,
                                    size_t stream_end);

// Decode JSON IR in wrapper format {ir, source_map} and convert to IRNode.
// Tries wrapper format first (TS test suite export), falls back to raw IR.
// ir_value_out (optional): if non-NULL, receives the retained IR EastValue*.
// source_map_out (optional): if non-NULL, receives a heap EastSourceMap* holding one reference
//   for the caller (drop it with east_source_map_release), or NULL when the wrapper carried
//   no stacks. Same ownership contract as east_beast2_decode_ir.
IRNode *east_json_decode_ir(const char *json, EastValue **ir_value_out,
                            EastSourceMap **source_map_out);

// The heap source map (one reference, the caller's) a decoded wrapper's
// `source_map` value describes — `{stacks: [[{filename, line, column}]]}` —
// or NULL when it carries no stacks.
EastSourceMap *east_source_map_from_value(EastValue *sm_val);

// Encode an IR value (IRType) as a beast2 (v5) blob whose header carries
// `source_map` (NULL: an empty map) — the twin of east_beast2_decode_ir, for
// re-encoding an IR file with its locations intact.
ByteBuffer *east_beast2_encode_ir(EastValue *ir_value, EastSourceMap *source_map);

// Beast v1 binary serialization (magic + type schema + twiddled values)
ByteBuffer *east_beast_encode(EastValue *value, EastType *type);
EastValue *east_beast_decode(const uint8_t *data, size_t len, EastType *type);

// CSV serialization
// config may be NULL for defaults, or an EastValue struct with Option fields
char *east_csv_encode(EastValue *array, EastType *type, EastValue *config);
EastValue *east_csv_decode(const char *csv, EastType *type, EastValue *config);
// CSV decode with detailed error message (caller frees *error_out on failure)
EastValue *east_csv_decode_with_error(const char *csv, EastType *type, EastValue *config,
                                      char **error_out);

// East text format
char *east_print_value(EastValue *value, EastType *type);
EastValue *east_parse_value(const char *text, EastType *type);
// East parse with detailed error message (caller frees *error_out on failure)
EastValue *east_parse_value_with_error(const char *text, EastType *type, char **error_out);
char *east_print_type(EastType *type);
EastType *east_parse_type(const char *text);

#endif
