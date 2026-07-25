/*
 * Beast2 decoder hardening gate (issue #34).
 *
 * The beast2 decoders are an untrusted-input boundary: every byte of a
 * blob handed to east_beast2_decode_full/auto/ir or
 * east_beast2_extract_type must be treated as adversarial. This gate
 * proves the decoders fail cleanly (NULL, no crash, no OOB access) on:
 *
 *   1. truncation at every prefix length of a valid encoding;
 *   2. single-byte corruption at every position of a valid encoding;
 *   3. crafted type tables with out-of-bounds child indices (the C3
 *      type-confusion trigger);
 *   4. overflowing container sizes (the C1/H1 allocation-overflow
 *      triggers), exercised directly against the value constructors.
 *
 * It also proves the hardening does not reject legitimate data: deep
 * (but reasonable) recursive values and mixed container values still
 * round-trip exactly.
 *
 * Run under ASan (run_leak_check.sh's build-asan configuration): an OOB
 * read/write anywhere in the decode path fails the gate even when the
 * result happens to be NULL.
 */
#include <east/east.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

static size_t hex_to_bytes(const char *hex, uint8_t *out, size_t cap)
{
    size_t n = strlen(hex) / 2;
    if (n > cap) return 0;
    for (size_t i = 0; i < n; i++) {
        unsigned v;
        sscanf(hex + i * 2, "%2x", &v);
        out[i] = (uint8_t)v;
    }
    return n;
}

/* List = Recursive(self => Variant{ nil: Null,
 *                                   cons: Struct{head: Integer, tail: self} }) */
static EastType *make_list_type(void)
{
    EastType *rec = east_recursive_type_new();
    const char *field_names[2] = {"head", "tail"};
    EastType *field_types[2] = {&east_integer_type, rec};
    EastType *cons = east_struct_type(field_names, field_types, 2);
    const char *case_names[2] = {"nil", "cons"};
    EastType *case_types[2] = {&east_null_type, cons};
    EastType *inner = east_variant_type(case_names, case_types, 2);
    east_recursive_type_set(rec, inner);
    return east_recursive_type_intern(rec);
}

static EastValue *make_list(EastType *list, size_t depth)
{
    EastValue *null_payload = east_null();
    EastValue *tail = east_variant_new("nil", null_payload, list);
    for (size_t i = 0; i < depth; i++) {
        EastValue *h = east_integer((int64_t)i);
        const char *names[2] = {"head", "tail"};
        EastValue *vals[2] = {h, tail};
        EastValue *payload = east_struct_new(names, vals, 2, NULL);
        east_value_release(h);
        east_value_release(tail);
        EastValue *cell = east_variant_new("cons", payload, list);
        east_value_release(payload);
        tail = cell;
    }
    return tail;
}

/* Dict<String, Array<Integer>> with a couple of entries, wrapped together
 * with a Vector<Float> and a Matrix<Integer> in a struct — covers the
 * string table, value table (array/dict), and vector/matrix decode paths. */
static EastValue *make_mixed(EastType **type_out)
{
    EastType *arr_t = east_array_type(&east_integer_type);
    EastType *dict_t = east_dict_type(&east_string_type, arr_t);
    EastType *vec_t = east_vector_type(&east_float_type);
    EastType *mat_t = east_matrix_type(&east_integer_type);
    const char *fnames[3] = {"d", "v", "m"};
    EastType *ftypes[3] = {dict_t, vec_t, mat_t};
    EastType *struct_t = east_struct_type(fnames, ftypes, 3);

    EastValue *dict = east_dict_new(&east_string_type, arr_t);
    for (int e = 0; e < 3; e++) {
        char key[16];
        snprintf(key, sizeof key, "key%d", e);
        EastValue *k = east_string(key);
        EastValue *arr = east_array_new(&east_integer_type);
        for (int i = 0; i < 4; i++) {
            EastValue *n = east_integer(e * 10 + i);
            east_array_push(arr, n);
            east_value_release(n);
        }
        east_dict_set(dict, k, arr);
        east_value_release(k);
        east_value_release(arr);
    }

    EastValue *vec = east_vector_new(&east_float_type, 5);
    for (size_t i = 0; i < 5; i++)
        ((double *)vec->data.vector.data)[i] = (double)i * 1.5;

    EastValue *mat = east_matrix_new(&east_integer_type, 2, 3);
    for (size_t i = 0; i < 6; i++)
        ((int64_t *)mat->data.matrix.data)[i] = (int64_t)i;

    const char *names[3] = {"d", "v", "m"};
    EastValue *vals[3] = {dict, vec, mat};
    EastValue *result = east_struct_new(names, vals, 3, struct_t);
    east_value_release(dict);
    east_value_release(vec);
    east_value_release(mat);

    east_type_release(arr_t);
    east_type_release(dict_t);
    east_type_release(vec_t);
    east_type_release(mat_t);
    *type_out = struct_t; /* transferred to caller */
    return result;
}

/* Decode every strict prefix of buf: must never crash; any non-NULL
 * result is released. ASan is the oracle for OOB access. */
static void sweep_truncation(const char *label, const uint8_t *data, size_t len)
{
    for (size_t cut = 0; cut < len; cut++) {
        EastValue *v = east_beast2_decode_auto(data, cut);
        if (v) east_value_release(v);
        EastType *t = east_beast2_extract_type(data, cut);
        if (t) east_type_release(t);
    }
    printf("  [+] %s: truncation sweep (%zu prefixes)\n", label, len);
}

/* Flip each byte in turn and decode: must never crash. */
static void sweep_corruption(const char *label, const uint8_t *data, size_t len)
{
    uint8_t *copy = malloc(len);
    const uint8_t patterns[3] = {0xFF, 0x80, 0x01};
    for (size_t p = 0; p < 3; p++) {
        for (size_t pos = 8; pos < len; pos++) { /* keep the magic intact */
            memcpy(copy, data, len);
            copy[pos] ^= patterns[p];
            EastValue *v = east_beast2_decode_auto(copy, len);
            if (v) east_value_release(v);
        }
    }
    free(copy);
    printf("  [+] %s: corruption sweep (%zu positions x 3 patterns)\n", label, len - 8);
}

/* ---- 6. beast2 v5 — segment-terminated record stream (issue #416) ---- */

static void v5_gate(void)
{
    printf("---- 6. beast2 v5 (record stream, #416) ----\n");

    /* 6a. Cross-runtime pinned writer fixture: batches ["a","b"] + ["c"],
     * codec none, self-contained, indexed. The SAME hex is pinned in
     * libs/east/src/serialization/beast2/v5/index.spec.ts and east-py's
     * tests/serialization/test_beast2_v5.py — the three runtimes must
     * produce and accept identical v5 streams. */
    static const char *shared_hex =
        "89456173740d0a0500050102010a00010000010100000505020161016200030301016300010100"
        "010215020801270000000000000089456173740d0af5";
    uint8_t shared[128];
    size_t shared_len = hex_to_bytes(shared_hex, shared, sizeof shared);

    EastType *arr_str = east_array_type(&east_string_type);
    {
        Beast2StreamWriter *w = east_beast2_writer_new(arr_str, EAST_BEAST2_CODEC_NONE, true, true);
        if (!w) {
            printf("FAIL: v5 writer_new\n");
            failures++;
        } else {
            const char *batch_strs[2][2] = {{"a", "b"}, {"c", NULL}};
            for (int b = 0; b < 2; b++) {
                EastValue *batch = east_array_new(&east_string_type);
                for (int i = 0; i < 2 && batch_strs[b][i]; i++) {
                    EastValue *s = east_string(batch_strs[b][i]);
                    east_array_push(batch, s);
                    east_value_release(s);
                }
                if (!east_beast2_writer_write(w, batch)) {
                    printf("FAIL: v5 writer_write batch %d\n", b);
                    failures++;
                }
                east_value_release(batch);
            }
            EastValue *empty = east_array_new(&east_string_type);
            east_beast2_writer_write(w, empty); /* skipped — no empty segments */
            east_value_release(empty);
            if (!east_beast2_writer_finish(w)) {
                printf("FAIL: v5 writer_finish\n");
                failures++;
            }
            ByteBuffer *out = east_beast2_writer_take(w);
            if (!out || out->len != shared_len || memcmp(out->data, shared, shared_len) != 0) {
                printf("FAIL: v5 writer bytes differ from the cross-runtime fixture\n");
                failures++;
            } else {
                printf("  [+] v5 writer matches the cross-runtime pinned bytes\n");
            }
            if (out) byte_buffer_free(out);
            east_beast2_writer_free(w);
        }

        /* Whole decode of the pinned bytes merges the segments. */
        EastValue *decoded = east_beast2_decode_full(shared, shared_len, arr_str);
        EastValue *expected = east_array_new(&east_string_type);
        const char *elems[3] = {"a", "b", "c"};
        for (int i = 0; i < 3; i++) {
            EastValue *s = east_string(elems[i]);
            east_array_push(expected, s);
            east_value_release(s);
        }
        if (!decoded || east_value_compare(decoded, expected) != 0) {
            printf("FAIL: v5 whole decode of the pinned fixture\n");
            failures++;
        } else {
            printf("  [+] v5 whole decode of the pinned fixture\n");
        }
        if (decoded) east_value_release(decoded);

        /* Segment reader sees the original batching + index counts. */
        Beast2SegmentReader *r = east_beast2_reader_new(shared, shared_len, arr_str);
        size_t seg_n = 0, elem_n = 0;
        if (!r || !east_beast2_reader_counts(r, &seg_n, &elem_n) || seg_n != 2 || elem_n != 3) {
            printf("FAIL: v5 reader counts (got %zu segments / %zu elements)\n", seg_n, elem_n);
            failures++;
        }
        int seen = 0;
        for (;;) {
            EastValue *seg = r ? east_beast2_reader_next(r) : NULL;
            if (!seg) break;
            seen++;
            east_value_release(seg);
        }
        if (!r || !east_beast2_reader_done(r) || seen != 2) {
            printf("FAIL: v5 reader iteration (saw %d segments)\n", seen);
            failures++;
        } else {
            printf("  [+] v5 reader yields the original segments\n");
        }
        if (r) east_beast2_reader_free(r);
        east_value_release(expected);

        sweep_truncation("v5 pinned fixture", shared, shared_len);
        sweep_corruption("v5 pinned fixture", shared, shared_len);
    }

    /* 6b. Well-known type-section hashes must match the TS runtime's — the
     * pinned constants below are the TS encoder's output. A drifted schema
     * (or a divergent structural type encoding) fails here. */
    {
        static const char *ir_header_hex = "89456173740d0a05010145cf4e0706d397df0100";
        static const char *etv_header_hex = "89456173740d0a0501020947b0dde16f86410100";
        uint8_t hdr[32];
        size_t hdr_len = hex_to_bytes(ir_header_hex, hdr, sizeof hdr);
        EastType *t = east_beast2_extract_type(hdr, hdr_len);
        if (t != east_ir_type) {
            printf("FAIL: v5 well-known IRType hash rejected (C/TS schema drift?)\n");
            failures++;
        } else {
            printf("  [+] v5 well-known IRType hash matches TS\n");
        }
        if (t) east_type_release(t);

        hdr_len = hex_to_bytes(etv_header_hex, hdr, sizeof hdr);
        t = east_beast2_extract_type(hdr, hdr_len);
        if (t != east_type_type) {
            printf("FAIL: v5 well-known EastTypeValueType hash rejected (C/TS schema drift?)\n");
            failures++;
        } else {
            printf("  [+] v5 well-known EastTypeValueType hash matches TS\n");
        }
        if (t) east_type_release(t);

        /* A flipped hash byte and an unregistered id must fail loudly. */
        hdr_len = hex_to_bytes(ir_header_hex, hdr, sizeof hdr);
        hdr[10] ^= 0xFF;
        if (east_beast2_extract_type(hdr, hdr_len) != NULL) {
            printf("FAIL: v5 drifted well-known hash was accepted\n");
            failures++;
        }
        free(east_builtin_get_error());
        hex_to_bytes(ir_header_hex, hdr, sizeof hdr);
        hdr[9] = 0x60;
        if (east_beast2_extract_type(hdr, hdr_len) != NULL) {
            printf("FAIL: v5 unknown well-known id was accepted\n");
            failures++;
        }
        free(east_builtin_get_error());
        printf("  [+] v5 well-known drift and unknown ids are refused\n");
    }

    /* 6c. Well-known round-trip through encode_v5: a type value under
     * east_type_type must emit the well-known section (kind 1, id 2). */
    {
        EastValue *tv = east_type_to_value(&east_integer_type);
        ByteBuffer *b = east_beast2_encode_v5(tv, east_type_type, EAST_BEAST2_CODEC_NONE, false);
        if (!b || b->len < 10 || b->data[8] != 0x01 || b->data[9] != 0x02) {
            printf("FAIL: v5 encode of a type value did not use the well-known section\n");
            failures++;
        } else {
            EastValue *back = east_beast2_decode_full(b->data, b->len, east_type_type);
            if (!back || east_value_compare(back, tv) != 0) {
                printf("FAIL: v5 type value round-trip\n");
                failures++;
            } else {
                printf("  [+] v5 type values round-trip via the well-known section\n");
            }
            if (back) east_value_release(back);
        }
        if (b) byte_buffer_free(b);
        east_value_release(tv);
    }

    /* 6c-bis. Container selection: encode_full writes the current default
     * (v5), encode_v4 pins the legacy container, and both decode through the
     * same magic-dispatching entry point. The v4 bytes are pinned against the
     * TypeScript reference — the escape hatch has to stay byte-compatible
     * across runtimes, not merely readable. */
    {
        static const char *TS_V4_HEX =
            "89456173740d0a04050102010a00070301610162016301000801060a000300010200";
        EastType *arr_str = east_array_type(&east_string_type);
        EastValue *rows = east_array_new(&east_string_type);
        const char *items[3] = {"a", "b", "c"};
        for (int i = 0; i < 3; i++) {
            EastValue *sv = east_string(items[i]);
            east_array_push(rows, sv);
            east_value_release(sv);
        }

        ByteBuffer *dflt = east_beast2_encode_full(rows, arr_str);
        ByteBuffer *v4 = east_beast2_encode_v4(rows, arr_str);
        if (!dflt || !v4 || dflt->len < 8 || v4->len < 8) {
            printf("FAIL: container-selection encode returned NULL\n");
            failures++;
        } else if (dflt->data[7] != 0x05 || v4->data[7] != 0x04) {
            printf("FAIL: expected default=v5 and encode_v4=v4, got 0x%02x / 0x%02x\n",
                   dflt->data[7], v4->data[7]);
            failures++;
        } else {
            char *hex = malloc(v4->len * 2 + 1);
            for (size_t i = 0; i < v4->len; i++)
                sprintf(hex + 2 * i, "%02x", v4->data[i]);
            hex[v4->len * 2] = '\0';
            if (strcmp(hex, TS_V4_HEX) != 0) {
                printf("FAIL: encode_v4 bytes differ from the TS reference\n"
                       "  got:      %s\n  expected: %s\n",
                       hex, TS_V4_HEX);
                failures++;
            } else {
                EastValue *from_v4 = east_beast2_decode_full(v4->data, v4->len, arr_str);
                EastValue *from_v5 = east_beast2_decode_full(dflt->data, dflt->len, arr_str);
                if (!from_v4 || !from_v5 || east_value_compare(from_v4, rows) != 0 ||
                    east_value_compare(from_v5, rows) != 0) {
                    printf("FAIL: v4/v5 blobs did not both decode to the original value\n");
                    failures++;
                } else {
                    printf("  [+] encode_full writes v5, encode_v4 pins v4, both decode\n");
                }
                if (from_v4) east_value_release(from_v4);
                if (from_v5) east_value_release(from_v5);
            }
            free(hex);
        }
        if (dflt) byte_buffer_free(dflt);
        if (v4) byte_buffer_free(v4);
        east_value_release(rows);
        east_type_release(arr_str);
    }

    /* 6d. Aliasing: a shared container encodes once (REF) and decodes to one
     * shared object; re-encoding the decoded value reproduces the bytes.
     * This also exercises refcount-1 elision — `inner` is multiply
     * referenced, the root is not. */
    {
        EastType *arr_int = east_array_type(&east_integer_type);
        EastType *arr_arr = east_array_type(arr_int);
        EastValue *inner = east_array_new(&east_integer_type);
        for (int i = 1; i <= 3; i++) {
            EastValue *n = east_integer(i);
            east_array_push(inner, n);
            east_value_release(n);
        }
        EastValue *outer = east_array_new(arr_int);
        east_array_push(outer, inner);
        east_array_push(outer, inner);
        east_value_release(inner);

        ByteBuffer *b = east_beast2_encode_v5(outer, arr_arr, EAST_BEAST2_CODEC_NONE, false);
        EastValue *decoded = b ? east_beast2_decode_full(b->data, b->len, arr_arr) : NULL;
        if (!decoded || decoded->data.array.len != 2 ||
            decoded->data.array.items[0] != decoded->data.array.items[1]) {
            printf("FAIL: v5 aliasing did not round-trip to a shared object\n");
            failures++;
        } else {
            ByteBuffer *b2 = east_beast2_encode_v5(decoded, arr_arr, EAST_BEAST2_CODEC_NONE, false);
            if (!b2 || b2->len != b->len || memcmp(b2->data, b->data, b->len) != 0) {
                printf("FAIL: v5 re-encode of aliased value differs\n");
                failures++;
            } else {
                printf("  [+] v5 aliasing round-trips (shared object, stable bytes)\n");
            }
            if (b2) byte_buffer_free(b2);
        }
        if (decoded) east_value_release(decoded);
        if (b) byte_buffer_free(b);
        east_value_release(outer);
        east_type_release(arr_arr);
        east_type_release(arr_int);
    }

    /* 6e. Deflate stream: 20 batches x 50 integers through the writer, whole
     * decode equals the batch concatenation, the reader sees 20 segments,
     * and the (compressed) blob survives the adversarial sweeps. */
    {
        EastType *arr_int = east_array_type(&east_integer_type);
        Beast2StreamWriter *w =
            east_beast2_writer_new(arr_int, EAST_BEAST2_CODEC_DEFLATE, true, true);
        EastValue *expected = east_array_new(&east_integer_type);
        for (int b = 0; b < 20 && w; b++) {
            EastValue *batch = east_array_new(&east_integer_type);
            for (int i = 0; i < 50; i++) {
                EastValue *n = east_integer(b * 50 + i);
                east_array_push(batch, n);
                east_array_push(expected, n);
                east_value_release(n);
            }
            if (!east_beast2_writer_write(w, batch)) {
                printf("FAIL: v5 deflate writer_write\n");
                failures++;
            }
            east_value_release(batch);
        }
        ByteBuffer *blob = NULL;
        if (w && east_beast2_writer_finish(w)) blob = east_beast2_writer_take(w);
        if (w) east_beast2_writer_free(w);

        EastValue *decoded = blob ? east_beast2_decode_full(blob->data, blob->len, arr_int) : NULL;
        if (!decoded || east_value_compare(decoded, expected) != 0) {
            printf("FAIL: v5 deflate whole decode\n");
            failures++;
        } else {
            printf("  [+] v5 deflate stream round-trips (%zu bytes for 1000 ints)\n", blob->len);
        }
        if (decoded) east_value_release(decoded);

        if (blob) {
            Beast2SegmentReader *r = east_beast2_reader_new(blob->data, blob->len, arr_int);
            size_t seg_n = 0, elem_n = 0;
            int seen = 0;
            if (r) {
                east_beast2_reader_counts(r, &seg_n, &elem_n);
                for (;;) {
                    EastValue *seg = east_beast2_reader_next(r);
                    if (!seg) break;
                    seen++;
                    east_value_release(seg);
                }
            }
            if (!r || !east_beast2_reader_done(r) || seen != 20 || seg_n != 20 || elem_n != 1000) {
                printf("FAIL: v5 deflate reader (%d segments, index %zu/%zu)\n", seen, seg_n,
                       elem_n);
                failures++;
            } else {
                printf("  [+] v5 deflate reader yields 20 segments (index 20/1000)\n");
            }
            if (r) east_beast2_reader_free(r);

            sweep_truncation("v5 deflate stream", blob->data, blob->len);
            sweep_corruption("v5 deflate stream", blob->data, blob->len);
            byte_buffer_free(blob);
        }
        east_value_release(expected);
        east_type_release(arr_int);
    }

    /* 6f. Crafted rejects: reserved zstd codec, unknown codec, oversized
     * frame declarations, and out-of-range backref deltas all fail cleanly. */
    {
        EastType *arr_int = east_array_type(&east_integer_type);
        /* magic + structural type section Array<Integer> + empty source map */
        static const char *hdr_hex = "89456173740d0a0500050102020a000100";
        uint8_t blob[64];
        size_t hdr_len = hex_to_bytes(hdr_hex, blob, sizeof blob);

        /* zstd frame (codec 2) */
        size_t len = hdr_len;
        blob[len++] = 0x02; /* codec 2 */
        blob[len++] = 0x01;
        blob[len++] = 0x01;
        blob[len++] = 0x00;
        if (east_beast2_decode_full(blob, len, arr_int) != NULL) {
            printf("FAIL: v5 zstd frame was accepted\n");
            failures++;
        }
        free(east_builtin_get_error());

        /* unknown codec 7 */
        blob[hdr_len] = 0x07;
        if (east_beast2_decode_full(blob, len, arr_int) != NULL) {
            printf("FAIL: v5 unknown codec was accepted\n");
            failures++;
        }
        free(east_builtin_get_error());

        /* decompression bomb: declared uncompressed length over the 1 GiB cap */
        len = hdr_len;
        blob[len++] = 0x00; /* codec none */
        blob[len++] = 0x81;
        blob[len++] = 0x80; /* varint 2^31 */
        blob[len++] = 0x80;
        blob[len++] = 0x80;
        blob[len++] = 0x08;
        blob[len++] = 0x00;
        if (east_beast2_decode_full(blob, len, arr_int) != NULL) {
            printf("FAIL: v5 oversized frame declaration was accepted\n");
            failures++;
        }
        free(east_builtin_get_error());

        /* out-of-range backref delta inside Array<Array<Integer>> */
        EastType *arr_arr = east_array_type(arr_int);
        static const char *ref_hex =
            "89456173740d0a0500070203020a000a01" /* magic + structural section */
            "0100"                               /* empty source map */
            "000505"                             /* frame: codec 0, 5 bytes */
            "0001010900";                        /* NEW, n=1, REF delta 9, term */
        uint8_t ref_blob[64];
        size_t ref_len = hex_to_bytes(ref_hex, ref_blob, sizeof ref_blob);
        if (east_beast2_decode_full(ref_blob, ref_len, arr_arr) != NULL) {
            printf("FAIL: v5 out-of-range backref was accepted\n");
            failures++;
        }
        free(east_builtin_get_error());
        printf("  [+] v5 crafted rejects (zstd, unknown codec, bomb, backref)\n");
        east_type_release(arr_arr);
        east_type_release(arr_int);
    }

    east_type_release(arr_str);
}

int main(void)
{
    east_type_of_type_init();

    /* ---- 1. Legitimate data still round-trips ---- */

    EastType *list = make_list_type();
    EastValue *deep = make_list(list, 1500); /* well within BEAST2_MAX_DEPTH */
    ByteBuffer *deep_buf = east_beast2_encode_full(deep, list);
    if (!deep_buf) {
        printf("FAIL: encode of deep list failed\n");
        return 1;
    }
    {
        EastValue *rt = east_beast2_decode_auto(deep_buf->data, deep_buf->len);
        if (!rt || east_value_compare(rt, deep) != 0) {
            printf("FAIL: deep recursive list did not round-trip\n");
            failures++;
        }
        if (rt) east_value_release(rt);
        printf("  [+] deep list (1500 cells) round-trips\n");
    }

    EastType *mixed_t = NULL;
    EastValue *mixed = make_mixed(&mixed_t);
    ByteBuffer *mixed_buf = east_beast2_encode_full(mixed, mixed_t);
    if (!mixed_buf) {
        printf("FAIL: encode of mixed value failed\n");
        return 1;
    }
    {
        EastValue *rt = east_beast2_decode_auto(mixed_buf->data, mixed_buf->len);
        if (!rt || east_value_compare(rt, mixed) != 0) {
            printf("FAIL: mixed container value did not round-trip\n");
            failures++;
        }
        if (rt) east_value_release(rt);
        printf("  [+] mixed dict/array/vector/matrix round-trips\n");
    }

    /* ---- 2. Adversarial sweeps over both encodings ---- */

    sweep_truncation("mixed", mixed_buf->data, mixed_buf->len);
    sweep_corruption("mixed", mixed_buf->data, mixed_buf->len);
    /* The deep-list blob is large; sweep its head (sections + table) and a
     * slice of the value stream rather than all ~10KB. */
    size_t deep_sweep = deep_buf->len < 2048 ? deep_buf->len : 2048;
    sweep_truncation("deep list", deep_buf->data, deep_sweep);
    sweep_corruption("deep list", deep_buf->data, deep_sweep);

    /* ---- 2b. No silent partials (#287) ----
     * Every section of a beast2-full blob is length-prefixed and the value
     * table's element counts are declared up front, so ANY strict prefix is
     * missing bytes some declared structure needs: typed decode of a prefix
     * must return NULL, never a value. Before #287 a cut inside a value-table
     * entry's trailing elements decoded to a silently SHORT array (failed
     * elements were skipped instead of failing the decode) — the
     * silent-truncation class this gate now pins shut. */
    {
        EastType *arr_t = east_array_type(mixed_t);
        EastValue *arr = east_array_new_with_capacity(mixed_t, 8);
        for (int i = 0; i < 8; i++)
            east_array_push(arr, mixed);
        ByteBuffer *arr_buf = east_beast2_encode_full(arr, arr_t);
        if (!arr_buf) {
            printf("FAIL: encode of array-of-mixed failed\n");
            failures++;
        } else {
            size_t partials = 0;
            for (size_t cut = 0; cut < arr_buf->len; cut++) {
                EastValue *v = east_beast2_decode_full(arr_buf->data, cut, arr_t);
                if (v) {
                    partials++;
                    east_value_release(v);
                }
            }
            if (partials > 0) {
                printf("FAIL: %zu truncated prefixes decoded to a value (silent partial, #287)\n",
                       partials);
                failures++;
            } else {
                printf("  [+] no truncated prefix decodes to a value (%zu prefixes, #287)\n",
                       arr_buf->len);
            }
            byte_buffer_free(arr_buf);
        }
        east_value_release(arr);
        east_type_release(arr_t);
    }

    /* ---- 2c. Corruption never yields a silently SHORT container (#287) ----
     * Array<Struct{name: String, qty: Float}> with 8 long unique names. For
     * every single-byte corruption, typed decode must either fail (NULL) or
     * produce the full 8 elements — corrupted CONTENT is fine, a silently
     * truncated container is the #287 data-corruption class. Before the fix,
     * a mid-entry element failure was skipped (short array, no error). */
    {
        const char *fn2[2] = {"name", "qty"};
        EastType *ft2[2] = {&east_string_type, &east_float_type};
        EastType *row_t = east_struct_type(fn2, ft2, 2);
        EastType *rows_t = east_array_type(row_t);
        EastValue *rows = east_array_new_with_capacity(row_t, 8);
        for (int i = 0; i < 8; i++) {
            char name[64];
            snprintf(name, sizeof name, "row-%d-abcdefghijklmnopqrstuvwxyz-%d", i, i * 7);
            EastValue *nv = east_string_len(name, strlen(name));
            EastValue *qv = east_float((double)i * 1.25);
            EastValue *vals[2] = {nv, qv};
            EastValue *row = east_struct_new(fn2, vals, 2, row_t);
            east_value_release(nv);
            east_value_release(qv);
            east_array_push(rows, row);
            east_value_release(row);
        }
        ByteBuffer *rows_buf = east_beast2_encode_full(rows, rows_t);
        if (!rows_buf) {
            printf("FAIL: encode of rows failed\n");
            failures++;
        } else {
            size_t short_decodes = 0;
            uint8_t *copy = malloc(rows_buf->len);
            const uint8_t patterns[3] = {0xFF, 0x80, 0x01};
            for (size_t p = 0; p < 3; p++) {
                for (size_t pos = 8; pos < rows_buf->len; pos++) {
                    memcpy(copy, rows_buf->data, rows_buf->len);
                    copy[pos] ^= patterns[p];
                    EastValue *v = east_beast2_decode_full(copy, rows_buf->len, rows_t);
                    if (v) {
                        if (v->kind == EAST_VAL_ARRAY && v->data.array.len != 8) short_decodes++;
                        east_value_release(v);
                    }
                }
            }
            free(copy);
            if (short_decodes > 0) {
                printf("FAIL: %zu corruptions decoded to a SHORT array (silent truncation, #287)\n",
                       short_decodes);
                failures++;
            } else {
                printf("  [+] no corruption yields a silently short container (%zu positions x 3, "
                       "#287)\n",
                       rows_buf->len - 8);
            }
            byte_buffer_free(rows_buf);
        }
        east_value_release(rows);
        east_type_release(rows_t);
        east_type_release(row_t);
    }

    /* ---- 3. Crafted type table: child index out of bounds (C3) ---- */
    {
        /* magic + type table: root=1, count=2,
         * entry0 = INTEGER, entry1 = ARRAY(child=1000) — 1000 >= 2. */
        uint8_t blob[32];
        size_t n = 0;
        const uint8_t magic[8] = {0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x04};
        memcpy(blob, magic, 8);
        n = 8;
        const uint8_t header[] = {
            0x01,             /* root_idx = 1 */
            0x02,             /* entry_count = 2 */
            0x02,             /* entry 0: INTEGER */
            0x0A, 0xE8, 0x07, /* entry 1: ARRAY, child = varint(1000) */
        };
        blob[n++] = (uint8_t)sizeof(header); /* header_byte_length */
        memcpy(blob + n, header, sizeof(header));
        n += sizeof(header);

        EastType *t = east_beast2_extract_type(blob, n);
        if (t) {
            printf("FAIL: OOB type-table child index was not rejected\n");
            failures++;
            east_type_release(t);
        } else {
            printf("  [+] OOB type-table child index rejected\n");
        }

        /* Same blob, root_idx out of bounds */
        blob[9] = 0x63; /* root_idx = 99 */
        t = east_beast2_extract_type(blob, n);
        if (t) {
            printf("FAIL: OOB type-table root index was not rejected\n");
            failures++;
            east_type_release(t);
        } else {
            printf("  [+] OOB type-table root index rejected\n");
        }
    }

    /* ---- 4. Allocation-size overflow guards (C1 / H1) ---- */
    {
        EastValue *a =
            east_array_new_with_capacity(&east_integer_type, (size_t)0x2000000000000001ULL);
        if (a) {
            printf("FAIL: overflowing array capacity was not rejected\n");
            failures++;
            east_value_release(a);
        } else {
            printf("  [+] overflowing array capacity rejected\n");
        }

        EastValue *m = east_matrix_new(&east_integer_type, (size_t)1 << 33, (size_t)1 << 33);
        if (m) {
            printf("FAIL: overflowing matrix dimensions were not rejected\n");
            failures++;
            east_value_release(m);
        } else {
            printf("  [+] overflowing matrix dimensions rejected\n");
        }
    }

    /* ---- 5. Headerless encode rejects mutable containers (issue #37) ---- */
    {
        /* Headerless beast2 has no value-table section, so a mutable container
         * cannot be represented. east_beast2_encode must fail loudly (NULL +
         * a posted error) rather than silently emit zero bytes. */
        EastType *arr_t = east_array_type(&east_integer_type);
        EastValue *arr = east_array_new(&east_integer_type);
        for (int i = 1; i <= 3; i++) {
            EastValue *n = east_integer(i);
            east_array_push(arr, n);
            east_value_release(n);
        }
        ByteBuffer *hb = east_beast2_encode(arr, arr_t);
        char *err = east_builtin_get_error();
        if (hb != NULL || err == NULL) {
            printf("FAIL: headerless encode of mutable container was not rejected\n");
            failures++;
            if (hb) byte_buffer_free(hb);
        } else {
            printf("  [+] headerless encode of mutable container rejected\n");
        }
        if (err) free(err);
        east_value_release(arr);
        east_type_release(arr_t);

        /* Scalars must still encode headerless (the guard is container-only). */
        EastValue *scalar = east_integer(42);
        ByteBuffer *sb = east_beast2_encode(scalar, &east_integer_type);
        if (!sb || sb->len == 0) {
            printf("FAIL: headerless encode of scalar Integer regressed\n");
            failures++;
        } else {
            printf("  [+] headerless encode of scalar still works\n");
        }
        if (sb) byte_buffer_free(sb);
        east_value_release(scalar);
    }

    /* ---- 5b. type-table section skip-cache (#417) ----
     * The truncation/corruption sweeps above already hammer the cache's
     * miss/verify paths; here: warm-hit correctness, and repopulation after
     * an explicit purge. */
    {
        EastValue *first = east_beast2_decode_auto(deep_buf->data, deep_buf->len);
        EastValue *second = east_beast2_decode_auto(deep_buf->data, deep_buf->len);
        if (!first || !second || east_value_compare(first, second) != 0) {
            printf("FAIL: cached type-table decode changed the result\n");
            failures++;
        } else {
            printf("  [+] type-table cache: warm decode equals cold decode\n");
        }
        if (first) east_value_release(first);
        if (second) east_value_release(second);

        east_beast2_type_cache_clear();
        EastValue *after = east_beast2_decode_auto(deep_buf->data, deep_buf->len);
        if (!after) {
            printf("FAIL: decode after type-cache purge\n");
            failures++;
        } else {
            printf("  [+] type-table cache: repopulates after purge\n");
            east_value_release(after);
        }
    }

    v5_gate();

    byte_buffer_free(deep_buf);
    byte_buffer_free(mixed_buf);
    east_value_release(deep);
    east_value_release(mixed);
    east_type_release(mixed_t);
    east_type_registry_clear();

    if (failures == 0) {
        printf("GATE PASS: beast2 decoders reject malformed input cleanly\n");
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
