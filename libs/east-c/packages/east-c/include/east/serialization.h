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

// BEAST2 with header (magic bytes + type schema + value)
ByteBuffer *east_beast2_encode_full(EastValue *value, EastType *type);
EastValue *east_beast2_decode_full(const uint8_t *data, size_t len, EastType *type);
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
