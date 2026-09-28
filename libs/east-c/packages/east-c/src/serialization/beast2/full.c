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

/* One type_reads_as walk: the pairs in progress through a recursive type, each
 * read exactly or not. A pair met again inside itself holds, since a recursive
 * type is its own unfolding. */
typedef struct {
    EastType **wire;
    EastType **asked;
    bool *exact;
    size_t depth;
    size_t cap;
} ReadsAsWalk;

/* Whether a body written as `wire` reads as `asked` (see
 * b2_decode_type_matches) — `exact`ly inside a collection or a function's
 * signature. */
static bool type_reads_as(EastType *wire, EastType *asked, ReadsAsWalk *walk, bool exact)
{
    if (wire == asked) return true;
    if (!wire || !asked) return false;
    if (wire->kind == EAST_TYPE_RECURSIVE || asked->kind == EAST_TYPE_RECURSIVE) {
        for (size_t i = 0; i < walk->depth; i++) {
            if (walk->wire[i] == wire && walk->asked[i] == asked && walk->exact[i] == exact)
                return true;
        }
        if (walk->depth == walk->cap) {
            size_t cap = walk->cap ? walk->cap * 2 : 8;
            EastType **w = realloc(walk->wire, cap * sizeof(EastType *));
            if (w) walk->wire = w;
            EastType **a = realloc(walk->asked, cap * sizeof(EastType *));
            if (a) walk->asked = a;
            bool *e = realloc(walk->exact, cap * sizeof(bool));
            if (e) walk->exact = e;
            if (!w || !a || !e) return false;
            walk->cap = cap;
        }
        walk->wire[walk->depth] = wire;
        walk->asked[walk->depth] = asked;
        walk->exact[walk->depth] = exact;
        walk->depth++;
        bool result = type_reads_as(
            wire->kind == EAST_TYPE_RECURSIVE ? wire->data.recursive.node : wire,
            asked->kind == EAST_TYPE_RECURSIVE ? asked->data.recursive.node : asked, walk, exact);
        walk->depth--;
        return result;
    }
    if (wire->kind == EAST_TYPE_NEVER) return !exact || asked->kind == EAST_TYPE_NEVER;
    if (wire->kind != asked->kind) return false;

    switch (wire->kind) {
    case EAST_TYPE_NULL:
    case EAST_TYPE_BOOLEAN:
    case EAST_TYPE_INTEGER:
    case EAST_TYPE_FLOAT:
    case EAST_TYPE_STRING:
    case EAST_TYPE_DATETIME:
    case EAST_TYPE_BLOB:
        return true;

    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
    case EAST_TYPE_REF:
    case EAST_TYPE_VECTOR:
    case EAST_TYPE_MATRIX:
        return type_reads_as(wire->data.element, asked->data.element, walk, true);

    case EAST_TYPE_DICT:
        return type_reads_as(wire->data.dict.key, asked->data.dict.key, walk, true) &&
               type_reads_as(wire->data.dict.value, asked->data.dict.value, walk, true);

    case EAST_TYPE_STRUCT:
    case EAST_TYPE_VARIANT: {
        bool is_struct = wire->kind == EAST_TYPE_STRUCT;
        EastTypeField *mine = is_struct ? wire->data.struct_.fields : wire->data.variant.cases;
        EastTypeField *theirs = is_struct ? asked->data.struct_.fields : asked->data.variant.cases;
        size_t n = is_struct ? wire->data.struct_.num_fields : wire->data.variant.num_cases;
        size_t m = is_struct ? asked->data.struct_.num_fields : asked->data.variant.num_cases;
        /* A variant's tags are its cases' positions: the header's cases must be
         * the asked variant's first ones. */
        if ((is_struct || exact) ? n != m : n > m) return false;
        for (size_t i = 0; i < n; i++) {
            if (strcmp(mine[i].name, theirs[i].name) != 0) return false;
            if (!type_reads_as(mine[i].type, theirs[i].type, walk, exact)) return false;
        }
        return true;
    }

    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        if (wire->data.function.num_inputs != asked->data.function.num_inputs) return false;
        for (size_t i = 0; i < wire->data.function.num_inputs; i++) {
            if (!type_reads_as(wire->data.function.inputs[i], asked->data.function.inputs[i], walk,
                               true))
                return false;
        }
        return type_reads_as(wire->data.function.output, asked->data.function.output, walk, true);

    case EAST_TYPE_NEVER:
    case EAST_TYPE_RECURSIVE:
        break; /* answered above */
    }
    return false;
}

bool b2_decode_type_matches(EastType *wire, EastType *asked)
{
    ReadsAsWalk walk = {0};
    bool reads = type_reads_as(wire, asked, &walk, false);
    free(walk.wire);
    free(walk.asked);
    free(walk.exact);
    if (reads) return true;
    char *got = east_print_type(wire);
    char *want = east_print_type(asked);
    size_t cap = (got ? strlen(got) : 0) + (want ? strlen(want) : 0) + 64;
    char *msg = malloc(cap);
    if (msg) {
        snprintf(msg, cap, "beast2: cannot decode a blob of type %s as %s", got ? got : "?",
                 want ? want : "?");
        east_builtin_error(msg);
        free(msg);
    } else {
        east_builtin_error("beast2: cannot decode a blob of another type");
    }
    free(got);
    free(want);
    return false;
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

const char *east_beast2_magic_problem(const uint8_t *data, size_t len, char *buf, size_t cap)
{
    static const uint8_t prefix[7] = {0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A};
    if (!data || len < 8) {
        snprintf(buf, cap, "Data too short for Beast2 format: %zu bytes", len);
        return buf;
    }
    for (int i = 0; i < 7; i++) {
        if (data[i] != prefix[i]) {
            snprintf(buf, cap, "Invalid Beast2 magic at offset %d: expected 0x%02x, got 0x%02x", i,
                     prefix[i], data[i]);
            return buf;
        }
    }
    if (data[7] != 0x04 && data[7] != 0x05) {
        snprintf(buf, cap, "Unknown Beast2 version: 0x%02x", data[7]);
        return buf;
    }
    return NULL;
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
