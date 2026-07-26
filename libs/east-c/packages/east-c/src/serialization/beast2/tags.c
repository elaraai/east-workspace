/*
 * BEAST2 tag bytes, kind→tag mapping, and low-level shared helpers.
 *
 * These constants and helpers are shared across all beast2 .c source
 * files via beast2/internal.h.
 */

#include "internal.h"

/* Map EastTypeKind → tag byte */
const uint8_t BEAST2_TAG_FOR_KIND[] = {
    [EAST_TYPE_NEVER] = BEAST2_TAG_NEVER,
    [EAST_TYPE_NULL] = BEAST2_TAG_NULL,
    [EAST_TYPE_BOOLEAN] = BEAST2_TAG_BOOLEAN,
    [EAST_TYPE_INTEGER] = BEAST2_TAG_INTEGER,
    [EAST_TYPE_FLOAT] = BEAST2_TAG_FLOAT,
    [EAST_TYPE_STRING] = BEAST2_TAG_STRING,
    [EAST_TYPE_DATETIME] = BEAST2_TAG_DATETIME,
    [EAST_TYPE_BLOB] = BEAST2_TAG_BLOB,
    [EAST_TYPE_ARRAY] = BEAST2_TAG_ARRAY,
    [EAST_TYPE_SET] = BEAST2_TAG_SET,
    [EAST_TYPE_DICT] = BEAST2_TAG_DICT,
    [EAST_TYPE_STRUCT] = BEAST2_TAG_STRUCT,
    [EAST_TYPE_VARIANT] = BEAST2_TAG_VARIANT,
    [EAST_TYPE_REF] = BEAST2_TAG_REF,
    [EAST_TYPE_RECURSIVE] = BEAST2_TAG_RECURSIVE,
    [EAST_TYPE_FUNCTION] = BEAST2_TAG_FUNCTION,
    [EAST_TYPE_ASYNC_FUNCTION] = BEAST2_TAG_ASYNC_FN,
    [EAST_TYPE_VECTOR] = BEAST2_TAG_VECTOR,
    [EAST_TYPE_MATRIX] = BEAST2_TAG_MATRIX,
};

/* Magic bytes for beast2-full format */
const uint8_t BEAST2_MAGIC[8] = {0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x04};

/* v5 container magic (version byte 0x05) and v5 footer magic (0xF5) */
const uint8_t BEAST2_MAGIC_V5[8] = {0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x05};
const uint8_t BEAST2_FOOTER_MAGIC_V5[8] = {0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0xF5};

bool b2_type_is_zero_width(const EastType *type)
{
    if (!type) return false;
    switch (type->kind) {
    case EAST_TYPE_NULL:
    case EAST_TYPE_NEVER:
        return true;
    case EAST_TYPE_STRUCT: {
        /* A struct of zero-width fields is itself zero-width (an empty
         * struct trivially so). */
        for (size_t i = 0; i < type->data.struct_.num_fields; i++) {
            if (!b2_type_is_zero_width(type->data.struct_.fields[i].type)) return false;
        }
        return true;
    }
    case EAST_TYPE_RECURSIVE:
        /* Guard against a self-referential walk: a recursive type always
         * reaches a variant tag or a container header, so it is never
         * zero-width in practice. */
        return false;
    default:
        return false;
    }
}

/* ================================================================== */
/*  Helpers for little-endian float writing/reading                    */
/* ================================================================== */

void b2_write_float64_le(ByteBuffer *buf, double val)
{
    uint8_t bytes[8];
    memcpy(bytes, &val, 8);
    /* On big-endian systems this would need byte-swapping.
     * Assuming little-endian (x86, ARM LE) for simplicity. */
    byte_buffer_write_bytes(buf, bytes, 8);
}

double b2_read_float64_le(const uint8_t *data, size_t *offset)
{
    double val;
    memcpy(&val, data + *offset, 8);
    *offset += 8;
    return val;
}

/* Read a varint-prefixed string, returning malloc'd string and setting *out_len */
char *b2_read_string_varint(const uint8_t *data, size_t len, size_t *offset, size_t *out_len)
{
    uint64_t slen;
    if (!read_varint_checked(data, len, offset, &slen)) {
        *out_len = 0;
        return NULL;
    }
    /* Overflow-safe bounds check: *offset <= len here, so len - *offset
     * cannot underflow, and a huge slen cannot wrap the comparison. */
    if (slen > len - *offset) {
        *out_len = 0;
        return NULL;
    }
    char *str = malloc(slen + 1);
    if (!str) {
        *out_len = 0;
        return NULL;
    }
    memcpy(str, data + *offset, slen);
    str[slen] = '\0';
    *offset += slen;
    *out_len = (size_t)slen;
    return str;
}
