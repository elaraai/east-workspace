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
// Purge the type-table section skip-cache (#417). Called by
// east_type_registry_clear (cached tables retain arena-backed types); useful
// directly only in tests or before tearing down the runtime by other means.
void east_beast2_type_cache_clear(void);
// BEAST2-full decode using the embedded type schema (self-describing)
EastValue *east_beast2_decode_auto(const uint8_t *data, size_t len);
// Extract the type schema from beast2-full encoded data (returns retained EastType*)
EastType *east_beast2_extract_type(const uint8_t *data, size_t len);

// Decode beast2-full IR and convert to IRNode in one shot.
// Keeps the type table alive across decode + IR conversion for O(1) type resolution.
// Returns NULL on failure. Caller must call ir_node_release on the result.
// ir_value_out (optional): if non-NULL, receives the retained IR EastValue* (for re-serialization).
// source_map_out (optional): if non-NULL, receives heap-allocated EastSourceMap* (caller owns;
//   free with east_source_map_free + free). When NULL, the decoded source map is discarded.
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

// Decode JSON IR in wrapper format {ir, source_map} and convert to IRNode.
// Tries wrapper format first (TS test suite export), falls back to raw IR.
// ir_value_out (optional): if non-NULL, receives the retained IR EastValue*.
// source_map_out (optional): if non-NULL, receives heap-allocated EastSourceMap* (caller owns).
IRNode *east_json_decode_ir(const char *json, EastValue **ir_value_out,
                            EastSourceMap **source_map_out);

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
