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
                        if (v->kind == EAST_VAL_ARRAY && v->data.array.len != 8)
                            short_decodes++;
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
                printf("  [+] no corruption yields a silently short container (%zu positions x 3, #287)\n",
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
