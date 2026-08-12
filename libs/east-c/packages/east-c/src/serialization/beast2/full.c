#include "internal.h"

/*  BEAST2 public entry points — magic dispatch across container versions.
 *
 *  The 8th magic byte is the container version: 0x04 = the globally-sectioned
 *  v4 container (v4/), 0x05 = the segment-terminated v5 record stream (v5/).
 *  Every decode entry point accepts both; encoders write v5 by default
 *  (east_beast2_encode_full), matching the TypeScript encodeBeast2For default
 *  — the shared compliance goldens pin one byte string per value, so the two
 *  defaults must move together. v4 stays reachable explicitly
 *  (east_beast2_encode_v4 — the sibling of TS's `{ version: 4 }` and
 *  east-py's `version=4`), as does the v5 streaming writer (v5/stream.c).
 *  See libs/east/src/serialization/beast2/SPEC.md for the magic registry
 *  and version policy.                                                 */
/* ================================================================== */

/* Returns the container version (4 or 5), or -1.
 * Short data and a wrong magic prefix return -1 silently (exactly the v4
 * bare-NULL behavior, so format probes stay quiet); a valid prefix with an
 * unknown version byte posts a distinct error, mirroring the TS decoder. */
static int beast2_detect_version(const uint8_t *data, size_t len)
{
    if (!data || len < 8) return -1;
    if (memcmp(data, BEAST2_MAGIC, 7) != 0) return -1;
    if (data[7] == 0x04) return 4;
    if (data[7] == 0x05) return 5;
    {
        char msg[64];
        snprintf(msg, sizeof(msg), "beast2: unknown container version 0x%02x", data[7]);
        east_builtin_error(msg);
    }
    return -1;
}

ByteBuffer *east_beast2_encode_full(EastValue *value, EastType *type)
{
    /* Deflate-framed, no trailing index — the TS encodeBeast2For defaults. */
#if EAST_BEAST2_WRITE_VERSION == 4
    return east_beast2_v4_encode_full(value, type);
#else
    return east_beast2_encode_v5(value, type, EAST_BEAST2_CODEC_DEFLATE, false);
#endif
}

ByteBuffer *east_beast2_encode_v4(EastValue *value, EastType *type)
{
    return east_beast2_v4_encode_full(value, type);
}

EastValue *east_beast2_decode_full(const uint8_t *data, size_t len, EastType *type)
{
    switch (beast2_detect_version(data, len)) {
    case 4:
        return east_beast2_v4_decode_full(data, len, type, false);
    case 5:
        return east_beast2_v5_decode_full(data, len, type, false);
    default:
        return NULL;
    }
}

EastValue *east_beast2_decode_full_frozen(const uint8_t *data, size_t len, EastType *type)
{
    switch (beast2_detect_version(data, len)) {
    case 4:
        return east_beast2_v4_decode_full(data, len, type, true);
    case 5:
        return east_beast2_v5_decode_full(data, len, type, true);
    default:
        return NULL;
    }
}

EastValue *east_beast2_decode_auto(const uint8_t *data, size_t len)
{
    switch (beast2_detect_version(data, len)) {
    case 4:
        return east_beast2_v4_decode_auto(data, len);
    case 5:
        return east_beast2_v5_decode_auto(data, len);
    default:
        return NULL;
    }
}

IRNode *east_beast2_decode_ir(const uint8_t *data, size_t len, EastValue **ir_value_out,
                              EastSourceMap **source_map_out)
{
    if (ir_value_out) *ir_value_out = NULL;
    if (source_map_out) *source_map_out = NULL;
    switch (beast2_detect_version(data, len)) {
    case 4:
        return east_beast2_v4_decode_ir(data, len, ir_value_out, source_map_out);
    case 5:
        return east_beast2_v5_decode_ir(data, len, ir_value_out, source_map_out);
    default:
        return NULL;
    }
}

EastType *east_beast2_extract_type(const uint8_t *data, size_t len)
{
    switch (beast2_detect_version(data, len)) {
    case 4:
        return east_beast2_v4_extract_type(data, len);
    case 5:
        return east_beast2_v5_extract_type(data, len);
    default:
        return NULL;
    }
}
