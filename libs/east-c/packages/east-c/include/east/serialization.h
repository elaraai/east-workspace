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
 * STRICT: it accepts exactly what `jsonSchemaFor(T)` describes. An integer
 * must be a quoted decimal in i64 range with no leading zeros and no sign on
 * zero; a timestamp is any RFC 3339 date-time (what the schema's format
 * "date-time" names, read through the parser east_json_decode shares) whose
 * instant falls in years 0001..9999; a blob's hex must be lowercase; a string
 * must be well-formed UTF-8 (a malformed sequence is refused, never
 * repaired). A float parses the same under any LC_NUMERIC (east_strtod_c).
 *
 * Every refusal is "<pointer>: <message>" — an array element located by its
 * index, an object member by its name, RFC 6901-escaped — and the message is
 * word for word what east-node's reader produces: the shared compliance
 * corpus pins the text on every runtime, which is what makes a published
 * contract enforceable wherever it is read. What the reader skips past (the
 * members before a pointer target, a field the type does not model) is still
 * held to JSON's grammar and to the JSON_MAX_DEPTH nesting bound, though
 * nothing after the container being iterated is examined.
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
 * Struct of exactly `key` (a String) and `value`, in either declared order:
 * the struct is built in the type's own order, and the type is checked before
 * anything is consumed, so a refused call leaves the reader where it was.
 * NULL on failure with *error_out set. */
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
// Array/Set/Dict roots, and then scopes aliasing per root element as the
// streaming writer does — an index-less encode aliases across the whole
// value. Returns NULL on failure (message via east_builtin_get_error).
ByteBuffer *east_beast2_encode_v5(EastValue *value, EastType *type, int32_t codec_id,
                                  bool with_index);

// Paged whole-value v5 encode (the C mirror of TypeScript's
// encodeBeast2PagedFor): one Array/Set/Dict value in, a segmented,
// self-contained, INDEXED blob out, written through the element writer below
// — so its segments fall where the content-defined cut rule places them, and
// the bytes are a function of the value. Returns NULL on failure (message via
// east_builtin_get_error).
ByteBuffer *east_beast2_encode_paged(EastValue *value, EastType *type, int32_t codec_id);

// The content-defined cut rule's pinned bounds (v5/SPEC.md, "Segmentation
// rules"): counts in elements (pairs for a Dict), sizes in logical bytes —
// the canonical encoding before compression, which per-element aliasing makes
// a function of the element alone and so identical in every runtime. A
// segment's hash is consulted once it holds MIN_COUNT elements or MIN_BYTES;
// the threshold makes a segment about TARGET_COUNT narrow elements or
// TARGET_BYTES of wide ones; one at MAX_COUNT or MAX_BYTES always closes.
#define EAST_BEAST2_SEGMENT_MIN_COUNT 256
#define EAST_BEAST2_SEGMENT_TARGET_COUNT 1024
#define EAST_BEAST2_SEGMENT_MAX_COUNT 4096
#define EAST_BEAST2_SEGMENT_MIN_BYTES (64u * 1024u)
#define EAST_BEAST2_SEGMENT_TARGET_BYTES (1024u * 1024u)
#define EAST_BEAST2_SEGMENT_MAX_BYTES (8u * 1024u * 1024u)

// The rule ids a manifest records for the segments it names: the hash, the
// bounds, and the version of the table above. A change to any of them is a
// new rule id, never a silent re-cut.
#define EAST_BEAST2_SEGMENT_RULE_KEYED "cdc/keyed/fnv1a-fmix32/256-1024-4096/64K-1M-8M/2"
#define EAST_BEAST2_SEGMENT_RULE_ARRAY "cdc/array/fnv1a-fmix32/256-1024-4096/64K-1M-8M/2"

// The 64-bit FNV-1a hash of `bytes`, pinned identically in every runtime.
uint64_t east_beast2_fnv1a64(const uint8_t *bytes, size_t len);

// The boundary hash of an element: the low 32-bit word of its FNV-1a hash,
// mixed by murmur3's 32-bit finalizer. `bytes` is a Set/Dict element's key
// fence bytes, or an Array element's canonical bytes.
uint32_t east_beast2_segment_boundary_hash(const uint8_t *bytes, size_t len);

// The rule's hash test alone: whether an element with boundary hash `hash`
// starts a segment after an open segment of `count` (at least 1) elements and
// `bytes` logical bytes. The threshold is 2^32 × max(1 / TARGET_COUNT,
// (bytes / count) / TARGET_BYTES).
bool east_beast2_segment_is_boundary(uint32_t hash, size_t count, size_t bytes);

// The whole rule for every element but a collection's first: whether the
// element whose hashed bytes are `hash_input` starts a segment after an open
// segment of `count` elements and `bytes` logical bytes.
bool east_beast2_starts_segment_after(size_t count, size_t bytes, const uint8_t *hash_input,
                                      size_t len);

// The canonical bare encoding of one value: its v5 value bytes with no
// container, header or index around them, encoded against a fresh context so
// no container REF can fire and the bytes depend on the value alone. This is
// what a segment fence holds and what the boundary rule hashes. Returns NULL
// with the message posted; the caller frees the buffer.
ByteBuffer *east_beast2_encode_fence(EastValue *value, EastType *type);

// The element indices at which a collection's segments begin under the cut
// rule, excluding 0, in ascending order — the whole segmentation of one value
// in one call. Writes at most `out_cap` of them and returns how many there
// are. Returns SIZE_MAX with the message posted on a non-collection root, an
// element that fails to encode, or when `out` was given and too small.
size_t east_beast2_segment_starts(EastValue *collection, EastType *type, size_t *out,
                                  size_t out_cap);

// Streaming v5 writer: each write() encodes one batch (a value of the declared
// Array/Set/Dict type) as one root segment, so writer memory is O(batch).
// Output bytes accumulate internally; drain with take() (returns a ByteBuffer
// the caller frees, or NULL when nothing is pending). finish() appends the
// terminator (and index + footer unless disabled). self_contained scopes
// aliasing per root element, so the output is pageable and an element's
// bytes depend on the element alone (the default for paging). Where the
// segments fall is the caller's choice here; a stored collection is written
// through the element writer below, which cuts where the rule says.
typedef struct Beast2StreamWriter Beast2StreamWriter;
Beast2StreamWriter *east_beast2_writer_new(EastType *type, int32_t codec_id, bool self_contained,
                                           bool with_index);
bool east_beast2_writer_write(Beast2StreamWriter *w, EastValue *batch);
// One root segment from elements that are already encoded — `count` elements
// back to back in `elements`, each in its canonical bytes with aliasing scoped
// to itself. The bytes are copied before this returns; their order is the
// caller's to keep (nothing here decodes them to check a Set or Dict's
// ascent). A zero count writes nothing.
bool east_beast2_writer_write_encoded(Beast2StreamWriter *w, size_t count, const uint8_t *elements,
                                      size_t len);
ByteBuffer *east_beast2_writer_take(Beast2StreamWriter *w);
bool east_beast2_writer_finish(Beast2StreamWriter *w);
void east_beast2_writer_free(Beast2StreamWriter *w);

// Frame parallelism (issue #763). Opt in before the second segment and the
// writer deflates frames on a pool of worker threads — one per CPU the process
// may use (the affinity mask, capped by the cgroup CPU quota), and at most 32:
// the ring holds two segments per worker and throughput flattens well before
// that — appending them in order so the bytes are identical to the inline
// writer's. A single-core host stays inline. take() then returns only the
// frames already done, and finish() waits for the rest.
void east_beast2_writer_set_parallel(Beast2StreamWriter *w, bool parallel);

// The canonical writer of a collection blob (the C mirror of TypeScript's
// Beast2ElementWriter): elements go in one at a time, in canonical order, and
// segments come out wherever the content-defined cut rule places them. Each
// element is encoded as it arrives with aliasing scoped to itself, so the blob
// is a function of the value — whichever runtime writes it, however its
// elements were produced. Memory is one open segment. The blob is always
// self-contained and indexed; drain it with take(), as for the stream writer.
//
// add() takes an Array or Set element, add_pair() a Dict's key and value; a
// Set element or Dict key must ascend strictly from the last in East order.
// add_encoded() takes an element already in its canonical bytes — for a Dict
// the key's bytes then the value's, `key_len` the key's length; for a Set the
// whole element; ignored for an Array — whose order is the caller's to keep.
// An add that fails leaves the writer as it was, with the message posted.
typedef struct Beast2ElementWriter Beast2ElementWriter;
Beast2ElementWriter *east_beast2_element_writer_new(EastType *type, int32_t codec_id);
void east_beast2_element_writer_set_parallel(Beast2ElementWriter *w, bool parallel);
bool east_beast2_element_writer_add(Beast2ElementWriter *w, EastValue *element);
bool east_beast2_element_writer_add_pair(Beast2ElementWriter *w, EastValue *key, EastValue *value);
bool east_beast2_element_writer_add_encoded(Beast2ElementWriter *w, const uint8_t *element,
                                            size_t len, size_t key_len);
ByteBuffer *east_beast2_element_writer_take(Beast2ElementWriter *w);
// Writes the open segment, then the terminator, index and footer.
bool east_beast2_element_writer_finish(Beast2ElementWriter *w);
// Segments written so far; the open one is not counted until it closes.
size_t east_beast2_element_writer_segments(const Beast2ElementWriter *w);
void east_beast2_element_writer_free(Beast2ElementWriter *w);

// Segment output (the C mirror of TypeScript's Beast2SegmentSink): the writer
// hands each segment over once it is cut, in order, as the standalone blob
// carving it out of the collection's blob would give — the header, the
// segment's frame, the terminator, and an index naming the one segment — with
// its element count and its fence, the first key's canonical bytes (a Set
// element or a Dict key; empty for an Array). The sink returns false with the
// message posted to fail the add or finish that wrote the segment. A segment
// writer frames inline — set_parallel leaves it so — and take() returns
// nothing.
typedef struct {
    void *ctx;
    bool (*segment)(void *ctx, const uint8_t *blob, size_t len, size_t count, const uint8_t *fence,
                    size_t fence_len);
} Beast2SegmentSink;
Beast2ElementWriter *east_beast2_element_writer_new_segments(EastType *type, int32_t codec_id,
                                                             const Beast2SegmentSink *sink);
// The header every segment of a segment writer is written under (borrowed,
// valid until free); NULL for a blob writer.
const uint8_t *east_beast2_element_writer_header(const Beast2ElementWriter *w, size_t *len_out);

// Sorted runs (the C mirror of TypeScript's Beast2RunSorter): a Set's or
// Dict's elements go in in any order and come out as sorted canonical runs.
// Each element is encoded as it is added, with aliasing scoped to itself, so
// what the sorter holds is bounded by bytes rather than by what the elements
// decode to. A run closes once it holds EAST_BEAST2_RUN_MAX_COUNT elements
// (pairs, for a Dict) or EAST_BEAST2_RUN_MAX_BYTES of their encoding, keys and
// values both: its elements sort by key, stably, so a key's values stay in
// the order they were added; a key added more than once folds, `acc =
// merge(key, acc, value)` (Dict roots, with merge_fn), is kept once (Set
// roots, with union_mode), or is refused; and the run is written through the
// element writer as the canonical blob of its value. A key that repeats across
// runs is the merge's to fold (east/merge.h).
//
// The caps are platform constants, not settings: where a run closes decides
// how a repeated key's values group before they fold, which for a fold over
// floats decides the output's bytes, and both caps count what every runtime
// measures alike, so every runtime closes a run at the same element.
#define EAST_BEAST2_RUN_MAX_COUNT 131072
#define EAST_BEAST2_RUN_MAX_BYTES (64u * 1024u * 1024u)

// Where the runs go: open() starts run `run` — runs are numbered from 0 in the
// order they close — write() takes its next bytes, and close() follows its
// last, the blob complete. Each returns false with the message posted, which
// fails the add or finish writing the run; a run that fails is left without
// its close.
typedef struct {
    void *ctx;
    bool (*open)(void *ctx, size_t run);
    bool (*write)(void *ctx, const uint8_t *bytes, size_t len);
    bool (*close)(void *ctx);
} Beast2RunSink;

// merge_fn (Dict roots) is borrowed, and must be associative: a key's values
// fold within each run before the runs merge. NULL with the message posted
// for a root other than a Set or Dict, or a fold that does not fit it.
typedef struct Beast2RunSorter Beast2RunSorter;
Beast2RunSorter *east_beast2_run_sorter_new(EastType *type, int32_t codec_id,
                                            const Beast2RunSink *sink, EastCompiledFn *merge_fn,
                                            bool union_mode);
// Frames of every run deflate on a pool, as east_beast2_writer_set_parallel.
void east_beast2_run_sorter_set_parallel(Beast2RunSorter *s, bool parallel);
// add() takes a Set element, add_pair() a Dict's key and value. An element
// that fails to encode leaves the sorter as it was; a run that fails as it is
// written — a key added twice without a fold, the merge function's error, the
// sink's — ends the sorter. False with the message posted.
bool east_beast2_run_sorter_add(Beast2RunSorter *s, EastValue *element);
bool east_beast2_run_sorter_add_pair(Beast2RunSorter *s, EastValue *key, EastValue *value);
// Writes the open run, if it holds anything. Idempotent.
bool east_beast2_run_sorter_finish(Beast2RunSorter *s);
// Runs written so far; the open one is not counted until a cap or finish()
// closes it.
size_t east_beast2_run_sorter_runs(const Beast2RunSorter *s);
void east_beast2_run_sorter_free(Beast2RunSorter *s);

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

// ============================================================================
// Segment manifests (v5/SPEC.md, "Segment manifests"). A collection may be
// held as standalone segment blobs — each a v5 blob of one segment under the
// collection's header — and a manifest naming them in order. A manifest
// directory is the manifest's file and, in `<file>.segments/`, every object
// the manifest names — the header and each segment — as `<sha256>.beast2`:
// the layout e3 stages collection inputs in, and the one every runtime writes.
// ============================================================================

#define EAST_BEAST2_MANIFEST_KIND "$segments"

// The manifest struct — { kind, level, type, rule, header, entries: [{ hash,
// fence, count, bytes }] }, the struct TypeScript's CollectionManifestType
// declares. Interned, like every constructed type.
EastType *east_beast2_manifest_type(void);

// The manifest `data` holds: 1 with it in *manifest_out (retained); 0 when
// the data holds something else — not a v5 blob, another root type, or a
// struct of the manifest's shape with another kind; -1 with the message
// posted when it is typed as a manifest but does not decode, or names
// manifests rather than segments (a level above 0), which this build does not
// read.
int east_beast2_read_manifest(const uint8_t *data, size_t len, EastValue **manifest_out);

// Where a manifest's segments are read from: open() hands over segment i's
// standalone blob — and in *handle what close() needs to give it back — or
// returns false with the message posted; free(), when set, releases ctx once
// the reader is done with the source. A reader opens a segment for each read
// that decodes it, and closes it after.
typedef struct {
    void *ctx;
    bool (*open)(void *ctx, size_t i, const uint8_t **data, size_t *len, void **handle);
    void (*close)(void *ctx, void *handle, const uint8_t *data, size_t len);
    void (*free)(void *ctx);
} Beast2SegmentSource;

// Random access over a collection held as a manifest: the pager above, with
// the counts and fences taken from the manifest's entries — so a keyed read
// opens exactly the segment it lands in — and each segment from `source`. The
// manifest is retained. The source is taken: its free() runs with the
// pager's, or at once when this fails (NULL, message posted).
Beast2Pages *east_beast2_pages_new_manifest(EastValue *manifest, EastType *type,
                                            const Beast2SegmentSource *source);
// A lazy paged value over a manifest, as east_beast2_open_paged_view is over
// a blob: it holds no bytes of its own, and a hydrate decodes it segment by
// segment. The shape gate is east_beast2_open_paged_view's and the source is
// taken as above; NULL when either refuses.
EastValue *east_beast2_open_paged_manifest(EastValue *manifest, EastType *type, bool frozen,
                                           const Beast2SegmentSource *source);
// The whole collection a manifest holds, decoded segment by segment into one
// value — the value decoding the spliced blob gives. Takes the source.
EastValue *east_beast2_decode_manifest(EastValue *manifest, EastType *type, bool frozen,
                                       const Beast2SegmentSource *source);
// The two above over a manifest directory: `path` is the manifest's file (its
// decoded `manifest` the caller's), and segment i is
// `<path>.segments/<hash>.beast2`, mapped for each read.
EastValue *east_beast2_open_manifest_dir(const char *path, EastValue *manifest, EastType *type,
                                         bool frozen);
EastValue *east_beast2_decode_manifest_dir(const char *path, EastValue *manifest, EastType *type,
                                           bool frozen);

// The canonical writer of a collection as a manifest directory (the C mirror
// of TypeScript's Beast2ManifestWriter): elements go in as the element writer
// takes them, and out come the header, each segment the cut rule places, and
// then the manifest naming them, every object under the SHA-256 of its bytes
// in lowercase hex. object() receives each object — the header first, then
// each segment as it is cut; an Array holding two equal segments hands the
// same one over twice — and manifest() the manifest, last. Each returns false
// with the message posted, failing the add or finish that wrote it; a finish
// that fails writes no manifest.
typedef struct {
    void *ctx;
    bool (*object)(void *ctx, const char *hash, const uint8_t *bytes, size_t len);
    bool (*manifest)(void *ctx, const uint8_t *bytes, size_t len);
} Beast2ManifestSink;
typedef struct Beast2ManifestWriter Beast2ManifestWriter;
Beast2ManifestWriter *east_beast2_manifest_writer_new(EastType *type, int32_t codec_id,
                                                      const Beast2ManifestSink *sink);
// The writer of a manifest directory: the manifest at `path`, and every
// object in `<path>.segments/`, which is created when missing.
Beast2ManifestWriter *east_beast2_manifest_writer_new_dir(EastType *type, int32_t codec_id,
                                                          const char *path);
bool east_beast2_manifest_writer_add(Beast2ManifestWriter *w, EastValue *element);
bool east_beast2_manifest_writer_add_pair(Beast2ManifestWriter *w, EastValue *key,
                                          EastValue *value);
bool east_beast2_manifest_writer_add_encoded(Beast2ManifestWriter *w, const uint8_t *element,
                                             size_t len, size_t key_len);
bool east_beast2_manifest_writer_finish(Beast2ManifestWriter *w);
// Segments written so far; the open one is not counted until it closes.
size_t east_beast2_manifest_writer_segments(const Beast2ManifestWriter *w);
void east_beast2_manifest_writer_free(Beast2ManifestWriter *w);
// One whole Array/Set/Dict value written as a manifest directory at `path`.
bool east_beast2_write_manifest_dir(EastValue *value, EastType *type, int32_t codec_id,
                                    const char *path);

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
