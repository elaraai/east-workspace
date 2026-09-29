/*
 * Taking a delivered collection in — the C mirror of TypeScript's
 * intakeBeast2For (libs/east/src/serialization/beast2/v5/intake.ts) and of the
 * skipper it walks rows with (canonical.ts). The east-c CLI and east-py take
 * a delivery in through this, and the conformance corpus holds them and
 * east-node to the same output bytes and the same refusals, which is why
 * every message here is TypeScript's, word for word.
 *
 * Each segment of the delivery is walked by its type without building a
 * value, holding every row to the bytes the Writer writes. When every row of
 * a segment passes, its rows go to the Writer as they stand; that walk and the
 * Writer's framing are the whole cost for a delivery a Writer wrote. A
 * segment with a row the Writer would write otherwise is walked again under
 * the looser rules the decoder reads by — a varint need not be minimal, a NaN
 * may be the negative one, a container may come in several runs, and a row
 * may alias a container of an earlier row of its segment — and, when it
 * passes, is decoded and encoded again row by row. Anything else is refused,
 * naming the segment and what is wrong with it.
 *
 * Memory is one segment of the delivery, which is mapped, and the Writer's
 * open segment.
 */

#include "internal_v5.h"

#include <east/file_map.h>
#include <east/type_of_type.h>

#include <errno.h>
#include <math.h>
#include <stdarg.h>
#include <sys/stat.h>

/* ================================================================== */
/*  The walker (canonical.ts)                                          */
/* ================================================================== */

/* The largest zigzag form of a date a JavaScript Date holds: 8.64e15 ms
 * either side of the epoch. */
#define WALK_DATE_ZIGZAG_MAX 17280000000000000ULL
/* The most elements a container of zero-width elements holds, as every
 * decoder bounds it (BEAST2_MAX_ZERO_WIDTH_ELEMS). */
#define WALK_ZERO_WIDTH_MAX ((uint64_t)1 << 28)
/* JavaScript's Number.MAX_SAFE_INTEGER: the largest length a varint says. */
#define WALK_SAFE_INTEGER_MAX 9007199254740991ULL

typedef struct {
    bool lenient;
    EastType **defs; /* the containers defined so far, in definition order */
    size_t n_defs;
    size_t cap;
    char reason[256]; /* what is wrong, once a walk is refused */
} Walker;

static bool walk_refuse(Walker *w, const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(w->reason, sizeof(w->reason), fmt, ap);
    va_end(ap);
    return false;
}

/* A varint the Writer writes: minimal — or, lenient, not — and no larger
 * than a safe integer, in eight bytes at most. */
static bool walk_varint(Walker *w, const uint8_t *d, size_t len, size_t *off, const char *what,
                        uint64_t *out)
{
    size_t p = *off;
    uint64_t value = 0;
    for (int i = 0;; i++) {
        if (p >= len) return walk_refuse(w, "%s runs past the end of its bytes", what);
        uint8_t byte = d[p++];
        value |= (uint64_t)(byte & 0x7f) << (7 * i);
        if ((byte & 0x80) == 0) {
            if (byte == 0 && i > 0 && !w->lenient)
                return walk_refuse(w, "%s is not a minimal varint", what);
            break;
        }
        if (i == 7) return walk_refuse(w, "%s is larger than a safe integer", what);
    }
    if (value > WALK_SAFE_INTEGER_MAX)
        return walk_refuse(w, "%s is larger than a safe integer", what);
    *off = p;
    *out = value;
    return true;
}

/* An Integer: a zigzag varint of 64 bits at most. Ten bytes carry bits 63 and
 * up in the last, which 64 bits leave 1 — or, lenient, 0 too, when the varint
 * is padded. */
static bool walk_integer(Walker *w, const uint8_t *d, size_t len, size_t *off)
{
    size_t p = *off;
    for (int i = 0;; i++) {
        if (p >= len) return walk_refuse(w, "an Integer runs past the end of its bytes");
        uint8_t byte = d[p++];
        if ((byte & 0x80) == 0) {
            if (byte == 0 && i > 0 && !w->lenient)
                return walk_refuse(w, "an Integer is not a minimal varint");
            if (i == 9 && byte > 1) return walk_refuse(w, "an Integer is larger than 64 bits");
            break;
        }
        if (i == 9) return walk_refuse(w, "an Integer is larger than 64 bits");
    }
    *off = p;
    return true;
}

/* A DateTime: an Integer of the milliseconds of a date a Date holds. Seven
 * bytes or fewer always are one; more are measured. */
static bool walk_datetime(Walker *w, const uint8_t *d, size_t len, size_t *off)
{
    size_t start = *off;
    if (!walk_integer(w, d, len, off)) return false;
    size_t length = *off - start;
    if (length < 8) return true;
    uint64_t zigzag = 0;
    for (size_t i = length; i-- > 0;)
        zigzag = (zigzag << 7) | (uint64_t)(d[start + i] & 0x7f);
    if (zigzag > WALK_DATE_ZIGZAG_MAX)
        return walk_refuse(w, "a DateTime is outside the dates a Date holds");
    return true;
}

/* A Float: any 64 bits but a NaN other than the encoder's,
 * 0x7FF8000000000000 — or, lenient, the negative one the decoder also reads,
 * 0xFFF8000000000000. */
static bool walk_float(Walker *w, const uint8_t *d, size_t len, size_t *off)
{
    size_t p = *off;
    if (p + 8 > len) return walk_refuse(w, "a Float runs past the end of its bytes");
    uint8_t top = d[p + 7], next = d[p + 6];
    if ((top & 0x7f) == 0x7f && (next & 0xf0) == 0xf0) {
        bool low = (d[p] | d[p + 1] | d[p + 2] | d[p + 3] | d[p + 4] | d[p + 5]) == 0;
        bool infinite = low && (next & 0x0f) == 0;
        bool writers = low && next == 0xf8 && (top == 0x7f || (w->lenient && top == 0xff));
        if (!infinite && !writers)
            return walk_refuse(w, "a Float is a NaN other than the one the Writer writes");
    }
    *off = p + 8;
    return true;
}

/* A String: a length, then that many bytes of well-formed UTF-8 — no overlong
 * form, surrogate or code point past U+10FFFF. */
static bool walk_string(Walker *w, const uint8_t *d, size_t len, size_t *off)
{
    uint64_t length;
    if (!walk_varint(w, d, len, off, "a String's length", &length)) return false;
    size_t p = *off;
    if (length > len - p) return walk_refuse(w, "a String runs past the end of its bytes");
    size_t end = p + (size_t)length;
    while (p < end) {
        uint8_t lead = d[p];
        if (lead < 0x80) {
            p++;
            continue;
        }
        /* The well-formed sequences: the second byte's range turns on the lead. */
        int follow;
        uint8_t low = 0x80, high = 0xbf;
        if (lead >= 0xc2 && lead <= 0xdf) {
            follow = 1;
        } else if (lead == 0xe0) {
            follow = 2;
            low = 0xa0;
        } else if ((lead >= 0xe1 && lead <= 0xec) || lead == 0xee || lead == 0xef) {
            follow = 2;
        } else if (lead == 0xed) {
            follow = 2;
            high = 0x9f;
        } else if (lead == 0xf0) {
            follow = 3;
            low = 0x90;
        } else if (lead >= 0xf1 && lead <= 0xf3) {
            follow = 3;
        } else if (lead == 0xf4) {
            follow = 3;
            high = 0x8f;
        } else {
            return walk_refuse(w, "a String is not well-formed UTF-8");
        }
        if (p + (size_t)follow >= end) return walk_refuse(w, "a String is not well-formed UTF-8");
        uint8_t second = d[p + 1];
        if (second < low || second > high)
            return walk_refuse(w, "a String is not well-formed UTF-8");
        for (int k = 2; k <= follow; k++) {
            uint8_t byte = d[p + (size_t)k];
            if (byte < 0x80 || byte > 0xbf)
                return walk_refuse(w, "a String is not well-formed UTF-8");
        }
        p += (size_t)follow + 1;
    }
    *off = end;
    return true;
}

/* A mutable container's tag: 1 when NEW, whose content follows, recorded as a
 * definition of `type`; 0 for a REF to an earlier definition of the same
 * type; -1 when refused. */
static int walk_container(Walker *w, const uint8_t *d, size_t len, size_t *off, EastType *type)
{
    if (*off >= len) {
        walk_refuse(w, "a container runs past the end of its bytes");
        return -1;
    }
    uint8_t tag = d[(*off)++];
    if (tag == B2V5_TAG_NEW) {
        if (w->n_defs == w->cap) {
            size_t cap = w->cap ? w->cap * 2 : 64;
            EastType **grown = realloc(w->defs, cap * sizeof(EastType *));
            if (!grown) {
                walk_refuse(w, "a container cannot be recorded: out of memory");
                return -1;
            }
            w->defs = grown;
            w->cap = cap;
        }
        w->defs[w->n_defs++] = type;
        return 1;
    }
    if (tag != B2V5_TAG_REF) {
        walk_refuse(w, "a container's tag is 0x%x, neither NEW nor REF", tag);
        return -1;
    }
    uint64_t delta;
    if (!walk_varint(w, d, len, off, "a container alias", &delta)) return -1;
    if (delta < 1 || delta > w->n_defs) {
        walk_refuse(w, w->lenient ? "a container alias reaches outside its segment"
                                  : "a container alias reaches outside its root element");
        return -1;
    }
    EastType *target = w->defs[w->n_defs - (size_t)delta];
    if (target != type && !east_type_equal(target, type)) {
        walk_refuse(w, "a container alias names a container of another type");
        return -1;
    }
    return 0;
}

/* The count of a container's next run — `noun`'s length for the first, its
 * end after — held to one run unless lenient, and bounded for elements that
 * encode to no bytes. */
static bool walk_run(Walker *w, const uint8_t *d, size_t len, size_t *off, const char *noun,
                     uint64_t index, bool zero, uint64_t *n)
{
    char what[64];
    snprintf(what, sizeof(what), index == 0 ? "%s's length" : "%s's end", noun);
    if (!walk_varint(w, d, len, off, what, n)) return false;
    if (*n == 0) return true;
    if (index > 0 && !w->lenient)
        return walk_refuse(w, "%s's elements are not written in one run", noun);
    if (zero && index + *n > WALK_ZERO_WIDTH_MAX)
        return walk_refuse(w, "%s holds more elements than a reader takes", noun);
    return true;
}

/* A Set's element or a Dict's key, decoded from its bare bytes to be ordered:
 * keys are of immutable types, so each decodes on its own. NULL when it does
 * not decode. */
static EastValue *walk_key(const uint8_t *bytes, size_t len, EastType *type)
{
    B2V5DecodeCtx ctx;
    b2v5_dec_ctx_init(&ctx, NULL);
    size_t off = 0;
    EastValue *key = b2v5_decode_value(bytes, len, &off, type, &ctx);
    b2v5_dec_ctx_free(&ctx);
    if (key && off != len) {
        east_value_release(key);
        key = NULL;
    }
    return key;
}

static bool walk_value(Walker *w, const uint8_t *d, size_t len, size_t *off, EastType *type);

/* A Set's or Dict's content: each element (or key) walked and decoded, and
 * held to strict ascent from the one before; a Dict's value after its key. */
static bool walk_keyed(Walker *w, const uint8_t *d, size_t len, size_t *off, EastType *key_type,
                       EastType *value_type, const char *noun, const char *ascent,
                       const char *undecodable)
{
    bool zero =
        b2_type_is_zero_width(key_type) && (!value_type || b2_type_is_zero_width(value_type));
    EastValue *previous = NULL;
    bool ok = true;
    for (uint64_t index = 0; ok;) {
        uint64_t n;
        if (!walk_run(w, d, len, off, noun, index, zero, &n)) {
            ok = false;
            break;
        }
        if (n == 0) break;
        for (uint64_t i = 0; ok && i < n; i++, index++) {
            size_t start = *off;
            if (!walk_value(w, d, len, off, key_type)) {
                ok = false;
                break;
            }
            EastValue *key = walk_key(d + start, *off - start, key_type);
            if (!key) {
                ok = walk_refuse(w, "%s", undecodable);
                break;
            }
            if (index > 0 && east_value_compare(previous, key) >= 0) {
                east_value_release(key);
                ok = walk_refuse(w, "%s", ascent);
                break;
            }
            if (previous) east_value_release(previous);
            previous = key;
            if (value_type && !walk_value(w, d, len, off, value_type)) ok = false;
        }
    }
    if (previous) east_value_release(previous);
    return ok;
}

static bool walk_value(Walker *w, const uint8_t *d, size_t len, size_t *off, EastType *type)
{
    switch (type->kind) {
    case EAST_TYPE_NEVER:
        return walk_refuse(w, "a value of type Never");
    case EAST_TYPE_NULL:
        return true;
    case EAST_TYPE_BOOLEAN:
        if (*off >= len) return walk_refuse(w, "a Boolean runs past the end of its bytes");
        if (d[(*off)++] > 1) return walk_refuse(w, "a Boolean is neither 0 nor 1");
        return true;
    case EAST_TYPE_INTEGER:
        return walk_integer(w, d, len, off);
    case EAST_TYPE_FLOAT:
        return walk_float(w, d, len, off);
    case EAST_TYPE_STRING:
        return walk_string(w, d, len, off);
    case EAST_TYPE_DATETIME:
        return walk_datetime(w, d, len, off);
    case EAST_TYPE_BLOB: {
        uint64_t length;
        if (!walk_varint(w, d, len, off, "a Blob's length", &length)) return false;
        if (length > len - *off) return walk_refuse(w, "a Blob runs past the end of its bytes");
        *off += (size_t)length;
        return true;
    }
    case EAST_TYPE_VECTOR: {
        uint64_t width = type->data.element->kind == EAST_TYPE_BOOLEAN ? 1 : 8;
        uint64_t length;
        if (!walk_varint(w, d, len, off, "a Vector's length", &length)) return false;
        if (length > (len - *off) / width)
            return walk_refuse(w, "a Vector runs past the end of its bytes");
        *off += (size_t)(length * width);
        return true;
    }
    case EAST_TYPE_MATRIX: {
        uint64_t width = type->data.element->kind == EAST_TYPE_BOOLEAN ? 1 : 8;
        uint64_t rows, cols;
        if (!walk_varint(w, d, len, off, "a Matrix's rows", &rows)) return false;
        if (!walk_varint(w, d, len, off, "a Matrix's columns", &cols)) return false;
        if (rows > 0 && cols > ((len - *off) / width) / rows)
            return walk_refuse(w, "a Matrix runs past the end of its bytes");
        *off += (size_t)(rows * cols * width);
        return true;
    }
    case EAST_TYPE_ARRAY: {
        int tag = walk_container(w, d, len, off, type);
        if (tag <= 0) return tag == 0;
        EastType *element = type->data.element;
        bool zero = b2_type_is_zero_width(element);
        for (uint64_t index = 0;;) {
            uint64_t n;
            if (!walk_run(w, d, len, off, "an Array", index, zero, &n)) return false;
            if (n == 0) return true;
            for (uint64_t i = 0; i < n; i++, index++)
                if (!walk_value(w, d, len, off, element)) return false;
        }
    }
    case EAST_TYPE_SET: {
        int tag = walk_container(w, d, len, off, type);
        if (tag <= 0) return tag == 0;
        return walk_keyed(w, d, len, off, type->data.element, NULL, "a Set",
                          "a Set's elements do not strictly ascend",
                          "a Set's element does not decode");
    }
    case EAST_TYPE_DICT: {
        int tag = walk_container(w, d, len, off, type);
        if (tag <= 0) return tag == 0;
        return walk_keyed(w, d, len, off, type->data.dict.key, type->data.dict.value, "a Dict",
                          "a Dict's keys do not strictly ascend", "a Dict's key does not decode");
    }
    case EAST_TYPE_REF: {
        int tag = walk_container(w, d, len, off, type);
        if (tag <= 0) return tag == 0;
        return walk_value(w, d, len, off, type->data.element);
    }
    case EAST_TYPE_STRUCT:
        for (size_t i = 0; i < type->data.struct_.num_fields; i++)
            if (!walk_value(w, d, len, off, type->data.struct_.fields[i].type)) return false;
        return true;
    case EAST_TYPE_VARIANT: {
        uint64_t tag;
        if (!walk_varint(w, d, len, off, "a Variant's case", &tag)) return false;
        if (tag >= type->data.variant.num_cases)
            return walk_refuse(w, "a Variant's case %llu is not one of its %zu",
                               (unsigned long long)tag, type->data.variant.num_cases);
        return walk_value(w, d, len, off, type->data.variant.cases[tag].type);
    }
    case EAST_TYPE_RECURSIVE:
        if (!type->data.recursive.node) return walk_refuse(w, "a recursive type holds no type");
        return walk_value(w, d, len, off, type->data.recursive.node);
    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        return walk_refuse(w, "a function value, whose captures' types only its decoded IR says");
    }
    return walk_refuse(w, "a value of an unknown type");
}

/* ================================================================== */
/*  The intake (intake.ts)                                             */
/* ================================================================== */

typedef struct {
    EastType *type;     /* the declared collection type */
    EastType *head;     /* an Array or Set element, or a Dict key */
    EastType *value;    /* a Dict's value, else NULL */
    EastType *key;      /* a Set's element or a Dict's key; NULL for an Array */
    bool zero_rows;     /* a row encodes to no bytes */
    const char *noun;   /* "Set elements" or "Dict keys" */
    const char *output; /* the manifest's path */
    bool parallel;
    Beast2ManifestWriter *writer; /* opened at the first row, or at the end */
    EastValue *previous;          /* retained: the last row's key */
    B2V5EncodeCtx enc;            /* rows read and written again */
    ByteBuffer *scratch;
    Walker strict;
    Walker loose;
    size_t *spans; /* a segment's rows as it walks: start, end, key length */
    size_t n_spans;
    size_t spans_cap;
    uint8_t *inflated; /* the last deflated frame's logical bytes */
    size_t inflated_cap;
    EastBeast2IntakeStats stats;
} Intake;

static bool intake_refuse(const char *fmt, ...)
{
    char msg[2048];
    int prefix = snprintf(msg, sizeof(msg), "intake: ");
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg + prefix, sizeof(msg) - (size_t)prefix, fmt, ap);
    va_end(ap);
    east_builtin_error(msg);
    return false;
}

/* The refusal of segment `n`'s frame, for what is wrong with it. */
static bool intake_malformed(size_t n, const char *reason)
{
    return intake_refuse("segment %zu of the delivery is malformed: %s", n, reason);
}

/* A type as a refusal prints it: its type value, printed as East prints
 * values, as the other runtimes print it. Allocated; NULL on OOM. */
static char *intake_print_type(EastType *type)
{
    EastValue *value = east_type_to_value(type);
    char *printed = value ? east_print_value(value, east_type_type) : NULL;
    if (value) east_value_release(value);
    return printed;
}

static bool intake_refuse_type(EastType *wire, EastType *declared)
{
    char *w = intake_print_type(wire);
    char *d = intake_print_type(declared);
    bool r = intake_refuse("the delivery holds %s, not %s", w ? w : "?", d ? d : "?");
    free(w);
    free(d);
    return r;
}

/* Whether a type holds a function anywhere. `seen` holds the recursive types
 * already entered, which a self-reference must not enter again. */
static bool intake_holds_function(EastType *type, EastType **seen, size_t *n_seen, size_t cap)
{
    switch (type->kind) {
    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        return true;
    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
    case EAST_TYPE_REF:
    case EAST_TYPE_VECTOR:
    case EAST_TYPE_MATRIX:
        return intake_holds_function(type->data.element, seen, n_seen, cap);
    case EAST_TYPE_DICT:
        return intake_holds_function(type->data.dict.key, seen, n_seen, cap) ||
               intake_holds_function(type->data.dict.value, seen, n_seen, cap);
    case EAST_TYPE_STRUCT:
        for (size_t i = 0; i < type->data.struct_.num_fields; i++)
            if (intake_holds_function(type->data.struct_.fields[i].type, seen, n_seen, cap))
                return true;
        return false;
    case EAST_TYPE_VARIANT:
        for (size_t i = 0; i < type->data.variant.num_cases; i++)
            if (intake_holds_function(type->data.variant.cases[i].type, seen, n_seen, cap))
                return true;
        return false;
    case EAST_TYPE_RECURSIVE:
        for (size_t i = 0; i < *n_seen; i++)
            if (seen[i] == type) return false;
        if (*n_seen == cap || !type->data.recursive.node) return false;
        seen[(*n_seen)++] = type;
        return intake_holds_function(type->data.recursive.node, seen, n_seen, cap);
    default:
        return false;
    }
}

/* A varint as TypeScript's BufferReader reads it: ten bytes at most, minimal
 * or not. */
static bool intake_varint(const uint8_t *d, size_t len, size_t *off, uint64_t *out)
{
    size_t p = *off;
    uint64_t value = 0;
    for (int shift = 0;; shift += 7) {
        if (shift >= 64 || p >= len) return false;
        uint8_t byte = d[p++];
        value |= (uint64_t)(byte & 0x7f) << shift;
        if ((byte & 0x80) == 0) break;
    }
    *off = p;
    *out = value;
    return true;
}

static bool intake_open_writer(Intake *in)
{
    if (in->writer) return true;
    in->writer =
        east_beast2_manifest_writer_new_dir(in->type, EAST_BEAST2_CODEC_DEFLATE, in->output);
    if (!in->writer) return false;
    east_beast2_manifest_writer_set_parallel(in->writer, in->parallel);
    return true;
}

/* Holds a row's key to strict ascent from the last; takes the key's
 * reference. */
static bool intake_ascend(Intake *in, EastValue *key)
{
    if (in->previous && east_value_compare(in->previous, key) >= 0) {
        char *k = east_print_value(key, in->key);
        char *p = east_print_value(in->previous, in->key);
        intake_refuse("the delivery's %s must ascend strictly in East order, and %s follows %s",
                      in->noun, k ? k : "?", p ? p : "?");
        free(k);
        free(p);
        east_value_release(key);
        return false;
    }
    if (in->previous) east_value_release(in->previous);
    in->previous = key;
    return true;
}

/* Adds a row that is already the Writer's bytes. */
static bool intake_add_bytes(Intake *in, const uint8_t *row, size_t len, size_t key_len)
{
    if (in->key) {
        EastValue *key = walk_key(row, key_len, in->key);
        if (!key) return intake_refuse("a row's key does not decode");
        if (!intake_ascend(in, key)) return false;
    }
    if (!intake_open_writer(in)) return false;
    if (!east_beast2_manifest_writer_add_encoded(in->writer, row, len, key_len)) return false;
    in->stats.rows++;
    return true;
}

/* Adds a row decoded from bytes the Writer would write otherwise, encoding it
 * as the Writer does: aliasing scoped to the row. */
static bool intake_add_value(Intake *in, EastValue *head, EastValue *value)
{
    if (in->key) {
        east_value_retain(head);
        if (!intake_ascend(in, head)) return false;
    }
    in->scratch->len = 0;
    b2v5_enc_ctx_begin_element(&in->enc);
    b2v5_encode_value(in->scratch, head, in->head, &in->enc);
    size_t key_len = in->scratch->len;
    if (value) b2v5_encode_value(in->scratch, value, in->value, &in->enc);
    if (in->enc.failed) {
        in->enc.failed = false;
        return false;
    }
    if (!intake_open_writer(in)) return false;
    if (!east_beast2_manifest_writer_add_encoded(in->writer, in->scratch->data, in->scratch->len,
                                                 in->key ? key_len : 0))
        return false;
    in->stats.rows++;
    return true;
}

/* Walks a row with a walker: a Dict's key and then its value. */
static bool intake_walk_row(Intake *in, Walker *w, const uint8_t *d, size_t len, size_t *off,
                            size_t *key_len)
{
    size_t start = *off;
    if (!walk_value(w, d, len, off, in->head)) return false;
    *key_len = in->key ? *off - start : 0;
    return !in->value || walk_value(w, d, len, off, in->value);
}

/* Takes segment `n` in: `count` rows from `start` in a frame's logical bytes.
 * *end_out is where the segment ends. */
static bool intake_segment(Intake *in, size_t n, const uint8_t *logical, size_t llen, size_t start,
                           uint64_t count, size_t *end_out)
{
    in->stats.segments++;
    if (in->zero_rows && count > WALK_ZERO_WIDTH_MAX)
        return intake_malformed(n, "its element count is more than a reader takes");

    size_t off = start;
    bool canonical = true;
    in->n_spans = 0;
    for (uint64_t i = 0; i < count; i++) {
        size_t at = off;
        size_t key_len = 0;
        in->strict.n_defs = 0;
        if (!intake_walk_row(in, &in->strict, logical, llen, &off, &key_len)) {
            canonical = false;
            break;
        }
        if (in->n_spans + 3 > in->spans_cap) {
            size_t cap = in->spans_cap ? in->spans_cap * 2 : 3 * 1024;
            size_t *grown = realloc(in->spans, cap * sizeof(size_t));
            if (!grown) return intake_refuse("a segment cannot be walked: out of memory");
            in->spans = grown;
            in->spans_cap = cap;
        }
        in->spans[in->n_spans++] = at;
        in->spans[in->n_spans++] = off;
        in->spans[in->n_spans++] = key_len;
    }
    if (canonical) {
        for (size_t i = 0; i < in->n_spans; i += 3)
            if (!intake_add_bytes(in, logical + in->spans[i], in->spans[i + 1] - in->spans[i],
                                  in->spans[i + 2]))
                return false;
        *end_out = off;
        return true;
    }

    /* A row the Writer would write otherwise: the segment is held to what the
     * decoder reads, its rows sharing one definition table as a decoder's do,
     * and then read and written again. */
    in->stats.rewritten++;
    size_t loose = start;
    in->loose.n_defs = 0;
    for (uint64_t i = 0; i < count; i++) {
        size_t key_len;
        if (!intake_walk_row(in, &in->loose, logical, llen, &loose, &key_len))
            return intake_refuse("segment %zu of the delivery holds a row that does not decode: %s",
                                 n, in->loose.reason);
    }
    /* A row may alias a container of an earlier row, so every container the
     * segment defines is held until the segment is done. */
    B2V5DecodeCtx ctx;
    b2v5_dec_ctx_init(&ctx, NULL);
    size_t decoding = start;
    size_t held = 0; /* the containers retained: those of the rows decoded whole */
    bool ok = true;
    for (uint64_t i = 0; ok && i < count; i++) {
        EastValue *head = b2v5_decode_value(logical, llen, &decoding, in->head, &ctx);
        EastValue *value =
            head && in->value ? b2v5_decode_value(logical, llen, &decoding, in->value, &ctx) : NULL;
        if (!head || (in->value && !value)) {
            ok = intake_refuse("segment %zu of the delivery holds a row that does not decode", n);
        } else {
            for (; held < ctx.def_count; held++)
                east_value_retain(ctx.defs[held]);
            ok = intake_add_value(in, head, value);
        }
        if (head) east_value_release(head);
        if (value) east_value_release(value);
    }
    for (size_t k = 0; k < held; k++)
        east_value_release(ctx.defs[k]);
    b2v5_dec_ctx_free(&ctx);
    if (!ok) return false;
    *end_out = loose;
    return true;
}

/* The frame at `at`, no further than `end`, which holds segment `n`: its
 * logical bytes, and where the next frame starts. */
static bool intake_frame(Intake *in, const uint8_t *data, size_t n, size_t at, size_t end,
                         const uint8_t **logical, size_t *llen, size_t *next)
{
    if (at >= end) return intake_malformed(n, "its frame runs past the end of the delivery");
    size_t head_end = at + (end - at < 21 ? end - at : 21);
    size_t p = at;
    uint64_t codec, logical_bytes, payload_bytes;
    if (!intake_varint(data, head_end, &p, &codec) ||
        !intake_varint(data, head_end, &p, &logical_bytes) ||
        !intake_varint(data, head_end, &p, &payload_bytes))
        return intake_malformed(n, "its frame runs past the end of the delivery");
    if (logical_bytes > EAST_BEAST2_RUN_MAX_BYTES)
        return intake_refuse(
            "segment %zu of the delivery, at offset %zu, holds %llu bytes, more than the %u a "
            "segment is read in — write it again with a current Writer, whose segments stay "
            "under %u bytes: it was encoded whole, or cut by an older Writer that bounded a "
            "segment by its element count alone",
            n, at, (unsigned long long)logical_bytes, (unsigned)EAST_BEAST2_RUN_MAX_BYTES,
            (unsigned)EAST_BEAST2_SEGMENT_MAX_BYTES);
    if (codec != EAST_BEAST2_CODEC_NONE && codec != EAST_BEAST2_CODEC_DEFLATE)
        return intake_refuse(
            "segment %zu of the delivery is malformed: its frame's codec, %llu, is not one every "
            "runner reads",
            n, (unsigned long long)codec);
    if (codec == EAST_BEAST2_CODEC_NONE && payload_bytes != logical_bytes)
        return intake_malformed(n, "its frame's lengths disagree");
    if (payload_bytes > end - p)
        return intake_malformed(n, "its frame runs past the end of the delivery");
    if (codec == EAST_BEAST2_CODEC_NONE) {
        *logical = data + p;
    } else {
        if (logical_bytes > in->inflated_cap) {
            uint8_t *grown = realloc(in->inflated, logical_bytes ? (size_t)logical_bytes : 1);
            if (!grown) return intake_refuse("a frame cannot be read: out of memory");
            in->inflated = grown;
            in->inflated_cap = (size_t)logical_bytes;
        }
        if (!b2v5_inflate_raw(data + p, (size_t)payload_bytes, in->inflated, (size_t)logical_bytes))
            return intake_malformed(n,
                                    "its frame does not inflate to the length its header declares");
        *logical = in->inflated;
    }
    *llen = (size_t)logical_bytes;
    *next = p + (size_t)payload_bytes;
    return true;
}

/* A version 4 delivery: no segments, so it is read whole, within the limit a
 * segment is read in, and every row written again. */
static bool intake_v4(Intake *in, const uint8_t *data, size_t len, bool ranged)
{
    if (ranged)
        return intake_refuse(
            "the delivery is a version 4 blob, which has no segments to take a range of");
    if (len > EAST_BEAST2_RUN_MAX_BYTES)
        return intake_refuse("the delivery is a version 4 blob longer than %u bytes, which has no "
                             "segments to read it in — write it again with a current Writer",
                             (unsigned)EAST_BEAST2_RUN_MAX_BYTES);
    EastType *wire = east_beast2_extract_type(data, len);
    if (!wire) return intake_refuse("the delivery's header does not read");
    bool same = east_type_equal(wire, in->type);
    if (!same) intake_refuse_type(wire, in->type);
    east_type_release(wire);
    if (!same) return false;
    EastValue *value = east_beast2_decode_full(data, len, in->type);
    if (!value)
        return intake_refuse("the delivery is a version 4 blob that does not decode as its type");
    in->stats.segments = 1;
    in->stats.rewritten = 1;
    bool ok = true;
    switch (in->type->kind) {
    case EAST_TYPE_ARRAY:
        for (size_t i = 0; ok && i < value->data.array.len; i++)
            ok = intake_add_value(in, value->data.array.items[i], NULL);
        break;
    case EAST_TYPE_SET:
        for (size_t i = 0; ok && i < value->data.set.len; i++)
            ok = intake_add_value(in, east_set_at(value, i), NULL);
        break;
    default:
        for (size_t i = 0; ok && i < value->data.dict.len; i++)
            ok = intake_add_value(in, east_dict_key_at(value, i), east_dict_val_at(value, i));
        break;
    }
    east_value_release(value);
    return ok;
}

/* A piece: the segments [from, to) the delivery's index names, each its own
 * frame. */
static bool intake_range(Intake *in, const uint8_t *data, size_t len, int64_t from, int64_t to)
{
    if (len < 16 || memcmp(data + len - 8, BEAST2_FOOTER_MAGIC_V5, 8) != 0)
        return intake_refuse("the delivery has no index, so it has no segments to take a range of");
    Beast2SpliceExtents *e = east_beast2_splice_extents(data, len);
    if (!e) return intake_refuse("the delivery's index does not read");
    size_t count = e->segment_count;
    bool ok = true;
    if (from < 0 || to <= from || (uint64_t)to > count)
        ok = intake_refuse("segments [%lld, %lld) are not a range of the delivery's %zu",
                           (long long)from, (long long)to, count);
    else if (!e->self_contained)
        ok = intake_refuse(
            "the delivery's segments alias one another, so none is taken in apart from the rest");
    for (size_t i = (size_t)from; ok && i < (size_t)to; i++) {
        size_t at = e->offsets[i];
        size_t end = i + 1 < count ? e->offsets[i + 1] : e->segments_end;
        const uint8_t *logical;
        size_t llen, next;
        if (!intake_frame(in, data, i, at, end, &logical, &llen, &next)) {
            ok = false;
            break;
        }
        if (next != end) {
            ok = intake_malformed(i, "its frame is not the length the delivery's index gives it");
            break;
        }
        size_t pos = 0;
        uint64_t rows;
        if (!intake_varint(logical, llen, &pos, &rows)) {
            ok = intake_malformed(i, "its element count runs past the end of its frame");
            break;
        }
        if (rows != e->counts[i]) {
            ok = intake_malformed(i, "its element count disagrees with the delivery's index");
            break;
        }
        size_t segment_end;
        if (!intake_segment(in, i, logical, llen, pos, rows, &segment_end)) {
            ok = false;
            break;
        }
        if (segment_end != llen) {
            ok = intake_malformed(i, "its frame holds bytes after its last row");
            break;
        }
    }
    east_beast2_splice_extents_free(e);
    return ok;
}

/* The whole delivery: its value stream front to back, a frame at a time. The
 * first frame opens the root; each segment is its count and its rows, within
 * one frame; a count of zero ends the root. */
static bool intake_stream(Intake *in, const uint8_t *data, size_t len, size_t header_end)
{
    size_t at = header_end;
    size_t n = 0;
    const uint8_t *chunk;
    size_t clen, next;
    if (!intake_frame(in, data, n, at, len, &chunk, &clen, &next)) return false;
    at = next;
    size_t pos = 0;
    while (pos == clen) {
        if (!intake_frame(in, data, n, at, len, &chunk, &clen, &next)) return false;
        at = next;
        pos = 0;
    }
    if (chunk[pos++] != B2V5_TAG_NEW)
        return intake_refuse("the delivery's value stream does not open a collection");
    for (;;) {
        while (pos == clen) {
            if (!intake_frame(in, data, n, at, len, &chunk, &clen, &next)) return false;
            at = next;
            pos = 0;
        }
        uint64_t rows;
        if (!intake_varint(chunk, clen, &pos, &rows))
            return intake_malformed(n, "its element count runs past the end of its frame");
        if (rows == 0) break;
        size_t end;
        if (!intake_segment(in, n, chunk, clen, pos, rows, &end)) return false;
        pos = end;
        n++;
    }
    if (pos != clen)
        return intake_refuse("the delivery's value stream holds bytes after its last segment");
    return true;
}

static bool intake_run(Intake *in, const uint8_t *data, size_t len, bool ranged, int64_t from,
                       int64_t to)
{
    bool beast2 = len >= 8 && memcmp(data, BEAST2_MAGIC_V5, 7) == 0;
    if (!beast2 || (data[7] != 0x04 && data[7] != 0x05))
        return intake_refuse("the delivery is not a beast2 blob of version 4 or 5");
    if (data[7] == 0x04) return intake_v4(in, data, len, ranged);

    B2V5Header h;
    if (!b2v5_read_header(data, len, &h))
        return intake_refuse("the delivery's header does not read");
    bool same = east_type_equal(h.root_type, in->type);
    if (!same) intake_refuse_type(h.root_type, in->type);
    size_t header_end = h.frame_offset;
    b2v5_header_dispose(&h);
    if (!same) return false;
    return ranged ? intake_range(in, data, len, from, to)
                  : intake_stream(in, data, len, header_end);
}

/* Whether a delivery of `type` can be taken in: a collection with no function
 * in it. False with the refusal posted. */
static bool intake_check_type(EastType *type)
{
    if (!type || !b2v5_is_segmented_root(type))
        return intake_refuse("a delivery is an Array, Set or Dict, not %s",
                             type ? east_type_kind_name(type->kind) : "nothing");
    EastType *seen[64];
    size_t n_seen = 0;
    if (intake_holds_function(type, seen, &n_seen, 64))
        return intake_refuse("the declared type holds a function, which a delivery does not carry");
    return true;
}

bool east_beast2_intake(const uint8_t *data, size_t len, EastType *type, bool ranged, int64_t from,
                        int64_t to, const char *output, bool parallel, EastBeast2IntakeStats *stats)
{
    if (stats) memset(stats, 0, sizeof(*stats));
    if (!intake_check_type(type)) return false;
    if (!east_type_type) east_type_of_type_init();

    Intake in;
    memset(&in, 0, sizeof(in));
    in.type = type;
    in.output = output;
    in.parallel = parallel;
    in.head = type->kind == EAST_TYPE_DICT ? type->data.dict.key : type->data.element;
    in.value = type->kind == EAST_TYPE_DICT ? type->data.dict.value : NULL;
    in.key = type->kind == EAST_TYPE_ARRAY ? NULL : in.head;
    in.zero_rows = b2_type_is_zero_width(in.head) && (!in.value || b2_type_is_zero_width(in.value));
    in.noun = type->kind == EAST_TYPE_SET ? "Set elements" : "Dict keys";
    in.strict.lenient = false;
    in.loose.lenient = true;
    b2v5_enc_ctx_init(&in.enc, NULL, true);
    /* The root is definition 0, so rows define from 1, as the Writer's do. */
    in.enc.def_count = 1;
    in.enc.segment_base_def = 1;
    in.scratch = byte_buffer_new(4096);

    bool ok = in.scratch && intake_run(&in, data, len, ranged, from, to);
    /* An empty collection opens the writer here, for its manifest. */
    if (ok) ok = intake_open_writer(&in) && east_beast2_manifest_writer_finish(in.writer);
    if (ok && stats) *stats = in.stats;

    east_beast2_manifest_writer_free(in.writer);
    if (in.previous) east_value_release(in.previous);
    b2v5_enc_ctx_free(&in.enc);
    byte_buffer_free(in.scratch);
    free(in.strict.defs);
    free(in.loose.defs);
    free(in.spans);
    free(in.inflated);
    return ok;
}

bool east_beast2_intake_file(const char *path, EastType *type, bool ranged, int64_t from,
                             int64_t to, const char *output, bool parallel,
                             EastBeast2IntakeStats *stats)
{
    /* The declared type is refused before the file is read, as every runner
     * refuses it. */
    if (stats) memset(stats, 0, sizeof(*stats));
    if (!intake_check_type(type)) return false;
    size_t len = 0;
    void *ctx = NULL;
    uint8_t *data = map_input_file(path, &len, &ctx);
    if (!data) {
        /* An empty file cannot be mapped, and is no beast2 blob. */
        struct stat st;
        if (stat(path, &st) == 0 && st.st_size == 0) {
            static const uint8_t none[1] = {0};
            return east_beast2_intake(none, 0, type, ranged, from, to, output, parallel, stats);
        }
        char msg[1024];
        snprintf(msg, sizeof(msg), "intake: cannot read %s: %s", path, strerror(errno));
        east_builtin_error(msg);
        return false;
    }
    bool ok = east_beast2_intake(data, len, type, ranged, from, to, output, parallel, stats);
    input_release_mapping(ctx, data, len);
    return ok;
}
