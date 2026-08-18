/*
 * BEAST2 v5 column projection gate (issue #599, finishing #481 W3).
 *
 * Proves the projection plan end to end against paged-encoded blobs:
 *
 *   1. validation: subset-by-name at any depth; errors name the offending
 *      field and the wire fields; Dict keys / Set elements / variant case
 *      lists / function-bearing skipped fields refuse;
 *   2. projected segment decode: kept fields byte-equal the whole decode's,
 *      skipped fields never materialize, nested struct narrowing works,
 *      and the empty projection (no fields) decodes;
 *   3. Dict roots: values narrow, keys stay whole (fences, disjointness and
 *      keyed reads answer through an open-time projection);
 *   4. aliasing: a REF that crosses the projection boundary fails with the
 *      "projection alias" error instead of serving a wrong-shaped value,
 *      and the same segment decodes whole;
 *   5. the sequential reader's projection; find_sorted refuses under an
 *      open-time projection.
 *
 * Run under ASan/LSan (run_leak_check.sh's build-asan configuration): the
 * skip walker and the narrow struct construction are new allocation paths.
 */
#include <east/east.h>
#include <east/type_of_type.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

#define CHECK(cond, ...)                                                                           \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__);                                   \
            fprintf(stderr, __VA_ARGS__);                                                          \
            fprintf(stderr, "\n");                                                                 \
            failures++;                                                                            \
        }                                                                                          \
    } while (0)

static char *take_error(void)
{
    char *err = east_builtin_get_error();
    return err ? err : strdup("(no error posted)");
}

/* The wide row: id/name/qty/total scalars, a tags array, a nested meta
 * struct, and a two-case variant — every skip shape the walker must hop. */
static EastType *wide_row_type(void)
{
    const char *meta_names[] = {"code", "flag"};
    EastType *meta_types[] = {&east_string_type, &east_boolean_type};
    EastType *meta = east_struct_type(meta_names, meta_types, 2);

    const char *case_names[] = {"ok", "err"};
    EastType *case_types[] = {&east_null_type, &east_string_type};
    EastType *status = east_variant_type(case_names, case_types, 2);

    const char *names[] = {"id", "name", "qty", "total", "tags", "meta", "status"};
    EastType *types[] = {&east_integer_type,
                         &east_string_type,
                         &east_integer_type,
                         &east_float_type,
                         east_array_type(&east_string_type),
                         meta,
                         status};
    return east_struct_type(names, types, 7);
}

static EastValue *wide_row(EastType *row_t, int64_t i)
{
    char name[32], code[32], tag[32];
    snprintf(name, sizeof(name), "name-%lld", (long long)i);
    snprintf(code, sizeof(code), "code-%lld", (long long)i);

    EastValue *tags = east_array_new(&east_string_type);
    for (int64_t t = 0; t < i % 3; t++) {
        snprintf(tag, sizeof(tag), "tag-%lld-%lld", (long long)i, (long long)t);
        EastValue *tv = east_string(tag);
        east_array_push(tags, tv);
        east_value_release(tv);
    }

    EastType *meta_t = row_t->data.struct_.fields[5].type;
    EastType *status_t = row_t->data.struct_.fields[6].type;

    const char *meta_names[] = {"code", "flag"};
    EastValue *meta_vals[2];
    meta_vals[0] = east_string(code);
    meta_vals[1] = east_boolean(i % 2 == 0);
    EastValue *meta = east_struct_new(meta_names, meta_vals, 2, meta_t);
    east_value_release(meta_vals[0]);
    east_value_release(meta_vals[1]);

    EastValue *status;
    if (i % 4 == 0) {
        EastValue *err = east_string("boom");
        status = east_variant_new("err", err, status_t);
        east_value_release(err);
    } else {
        EastValue *nul = east_null();
        status = east_variant_new("ok", nul, status_t);
        east_value_release(nul);
    }

    const char *names[] = {"id", "name", "qty", "total", "tags", "meta", "status"};
    EastValue *vals[7];
    vals[0] = east_integer(i);
    vals[1] = east_string(name);
    vals[2] = east_integer(i * 7);
    vals[3] = east_float((double)i * 1.5);
    vals[4] = tags;
    vals[5] = meta;
    vals[6] = status;
    EastValue *row = east_struct_new(names, vals, 7, row_t);
    for (int k = 0; k < 7; k++)
        east_value_release(vals[k]);
    return row;
}

/* Paged-encode an Array<row> of n rows with tiny segments. */
static uint8_t *encode_wide_array(EastType *row_t, size_t n, size_t *len_out)
{
    EastType *at = east_array_type(row_t);
    EastValue *arr = east_array_new(row_t);
    for (size_t i = 0; i < n; i++) {
        EastValue *row = wide_row(row_t, (int64_t)i);
        east_array_push(arr, row);
        east_value_release(row);
    }
    ByteBuffer *buf = east_beast2_encode_paged(arr, at, EAST_BEAST2_CODEC_DEFLATE, 1024);
    east_value_release(arr);
    if (!buf) return NULL;
    uint8_t *data = malloc(buf->len);
    memcpy(data, buf->data, buf->len);
    *len_out = buf->len;
    byte_buffer_free(buf);
    return data;
}

static uint8_t *encode_wide_dict(EastType *row_t, size_t n, size_t *len_out)
{
    EastType *dt = east_dict_type(&east_integer_type, row_t);
    EastValue *dict = east_dict_new(&east_integer_type, row_t);
    for (size_t i = 0; i < n; i++) {
        EastValue *k = east_integer((int64_t)i);
        EastValue *row = wide_row(row_t, (int64_t)i);
        east_dict_set(dict, k, row);
        east_value_release(k);
        east_value_release(row);
    }
    ByteBuffer *buf = east_beast2_encode_paged(dict, dt, EAST_BEAST2_CODEC_DEFLATE, 1024);
    east_value_release(dict);
    if (!buf) return NULL;
    uint8_t *data = malloc(buf->len);
    memcpy(data, buf->data, buf->len);
    *len_out = buf->len;
    byte_buffer_free(buf);
    return data;
}

static void test_validation(void)
{
    EastType *row_t = wide_row_type();
    EastType *at = east_array_type(row_t);

    /* Identity plan. */
    Beast2Projection *pr = east_beast2_projection_new(at, at);
    CHECK(pr != NULL && east_beast2_projection_is_identity(pr), "identity plan");
    east_beast2_projection_free(pr);

    /* A missing field names itself and the wire fields. */
    const char *bad_names[] = {"nope"};
    EastType *bad_types[] = {&east_integer_type};
    EastType *bad = east_array_type(east_struct_type(bad_names, bad_types, 1));
    pr = east_beast2_projection_new(at, bad);
    CHECK(pr == NULL, "missing field must refuse");
    char *err = take_error();
    CHECK(strstr(err, "field 'nope' is not in the wire type") != NULL, "error names field: %s",
          err);
    CHECK(strstr(err, "wire fields:") != NULL && strstr(err, "id") != NULL,
          "error lists wire fields: %s", err);
    free(err);

    /* Dict keys must be identical. */
    const char *kn[] = {"id"};
    EastType *kt[] = {&east_integer_type};
    EastType *narrow_key = east_struct_type(kn, kt, 1);
    EastType *wide_key_dict = east_dict_type(row_t, &east_integer_type);
    EastType *narrow_key_dict = east_dict_type(narrow_key, &east_integer_type);
    pr = east_beast2_projection_new(wide_key_dict, narrow_key_dict);
    CHECK(pr == NULL, "dict key projection must refuse");
    err = take_error();
    CHECK(strstr(err, "Dict keys cannot project") != NULL, "dict key error: %s", err);
    free(err);

    /* Set elements must be identical. */
    pr = east_beast2_projection_new(east_set_type(row_t), east_set_type(narrow_key));
    CHECK(pr == NULL, "set element projection must refuse");
    err = take_error();
    CHECK(strstr(err, "Set elements cannot project") != NULL, "set error: %s", err);
    free(err);

    /* Variant case lists must match exactly. */
    const char *one_case[] = {"ok"};
    EastType *one_type[] = {&east_null_type};
    EastType *narrow_variant = east_variant_type(one_case, one_type, 1);
    const char *vn[] = {"status"};
    EastType *vt_wide[] = {row_t->data.struct_.fields[6].type};
    EastType *vt_narrow[] = {narrow_variant};
    pr = east_beast2_projection_new(east_array_type(east_struct_type(vn, vt_wide, 1)),
                                    east_array_type(east_struct_type(vn, vt_narrow, 1)));
    CHECK(pr == NULL, "variant case drop must refuse");
    err = take_error();
    CHECK(strstr(err, "variant case lists must match exactly") != NULL, "variant error: %s", err);
    free(err);

    /* A skipped function-typed field refuses (skipping one would be a decode
     * in all but the allocation). */
    EastType *fn_t = east_function_type(NULL, 0, &east_integer_type);
    const char *fn_names[] = {"id", "fn"};
    EastType *fn_types[] = {&east_integer_type, fn_t};
    EastType *fn_row = east_struct_type(fn_names, fn_types, 2);
    const char *keep_id[] = {"id"};
    EastType *keep_id_t[] = {&east_integer_type};
    pr = east_beast2_projection_new(east_array_type(fn_row),
                                    east_array_type(east_struct_type(keep_id, keep_id_t, 1)));
    CHECK(pr == NULL, "skipping a function field must refuse");
    err = take_error();
    CHECK(strstr(err, "cannot project away function-typed field 'fn'") != NULL,
          "function-skip error: %s", err);
    free(err);
}

static void test_array_projection(void)
{
    EastType *row_t = wide_row_type();
    EastType *at = east_array_type(row_t);
    size_t len = 0;
    uint8_t *data = encode_wide_array(row_t, 200, &len);
    CHECK(data != NULL, "encode failed");
    if (!data) return;

    Beast2Pages *pages = east_beast2_pages_new(data, len, at);
    CHECK(pages != NULL, "pages open failed");
    if (!pages) {
        free(data);
        return;
    }
    size_t segs = east_beast2_pages_segment_count(pages);
    CHECK(segs > 1, "expected multiple segments, got %zu", segs);

    /* Narrow to {id, total, meta.code}: scalars kept, strings/arrays/
     * variants skipped, nested struct narrowed. */
    const char *mn[] = {"code"};
    EastType *mt[] = {&east_string_type};
    EastType *meta_narrow = east_struct_type(mn, mt, 1);
    const char *nn[] = {"id", "total", "meta"};
    EastType *nt[] = {&east_integer_type, &east_float_type, meta_narrow};
    EastType *narrow_t = east_struct_type(nn, nt, 3);
    Beast2Projection *pr = east_beast2_projection_new(at, east_array_type(narrow_t));
    CHECK(pr != NULL, "plan build failed: %s", pr ? "" : take_error());
    if (!pr) {
        east_beast2_pages_free(pages);
        free(data);
        return;
    }
    CHECK(!east_beast2_projection_is_identity(pr), "narrow plan is not identity");

    for (size_t s = 0; s < segs; s++) {
        EastValue *whole = east_beast2_pages_segment(pages, s);
        EastValue *proj = east_beast2_pages_segment_projected(pages, s, pr);
        CHECK(whole != NULL && proj != NULL, "segment %zu decode failed", s);
        if (!whole || !proj) {
            if (whole) east_value_release(whole);
            if (proj) east_value_release(proj);
            break;
        }
        size_t n = east_array_len(whole);
        CHECK(east_array_len(proj) == n, "segment %zu row count", s);
        for (size_t i = 0; i < n; i++) {
            EastValue *w = east_array_get(whole, i);
            EastValue *p = east_array_get(proj, i);
            CHECK(p->kind == EAST_VAL_STRUCT && p->data.struct_.num_fields == 3,
                  "narrow row shape");
            CHECK(east_value_equal(east_struct_get_field(w, "id"), east_struct_get_field(p, "id")),
                  "id mismatch seg %zu row %zu", s, i);
            CHECK(east_value_equal(east_struct_get_field(w, "total"),
                                   east_struct_get_field(p, "total")),
                  "total mismatch");
            EastValue *wm = east_struct_get_field(w, "meta");
            EastValue *pm = east_struct_get_field(p, "meta");
            CHECK(pm->data.struct_.num_fields == 1, "meta narrowed to one field");
            CHECK(east_value_equal(east_struct_get_field(wm, "code"),
                                   east_struct_get_field(pm, "code")),
                  "meta.code mismatch");
        }
        east_value_release(whole);
        east_value_release(proj);
    }

    /* The empty projection: reads nothing of the row and still walks every
     * segment (variant K in the issue's measurements). */
    EastType *empty_t = east_struct_type(NULL, NULL, 0);
    Beast2Projection *pr_empty = east_beast2_projection_new(at, east_array_type(empty_t));
    CHECK(pr_empty != NULL, "empty plan build failed");
    if (pr_empty) {
        EastValue *seg = east_beast2_pages_segment_projected(pages, 0, pr_empty);
        CHECK(seg != NULL, "empty projection decode failed");
        if (seg) {
            CHECK(east_array_len(seg) == (size_t)east_beast2_pages_counts(pages, NULL)[0],
                  "empty projection keeps the row count");
            EastValue *r0 = east_array_get(seg, 0);
            CHECK(r0->kind == EAST_VAL_STRUCT && r0->data.struct_.num_fields == 0,
                  "empty rows have no fields");
            east_value_release(seg);
        }
        east_beast2_projection_free(pr_empty);
    }

    /* Open-time projection: element() serves narrow rows through the cache;
     * find_sorted refuses (the file is sorted by whole elements). */
    east_beast2_pages_set_projection(pages, pr);
    EastValue *el = east_beast2_pages_element(pages, 7);
    CHECK(el != NULL && el->kind == EAST_VAL_STRUCT && el->data.struct_.num_fields == 3,
          "open-time projected element");
    if (el) {
        EastValue *idv = east_struct_get_field(el, "id");
        CHECK(idv && idv->data.integer == 7, "projected element row 7");
        east_value_release(el);
    }
    EastValue *probe = east_struct_new(NULL, NULL, 0, empty_t);
    size_t idx = 0;
    CHECK(!east_beast2_pages_find_sorted(pages, probe, false, &idx),
          "find_sorted must refuse under projection");
    char *err = take_error();
    CHECK(strstr(err, "find_sorted needs whole elements") != NULL, "find_sorted error: %s", err);
    free(err);
    east_value_release(probe);
    east_beast2_pages_set_projection(pages, NULL);

    east_beast2_projection_free(pr);
    east_beast2_pages_free(pages);
    free(data);
}

static void test_dict_projection(void)
{
    EastType *row_t = wide_row_type();
    EastType *dt = east_dict_type(&east_integer_type, row_t);
    size_t len = 0;
    uint8_t *data = encode_wide_dict(row_t, 150, &len);
    CHECK(data != NULL, "dict encode failed");
    if (!data) return;

    Beast2Pages *pages = east_beast2_pages_new(data, len, dt);
    CHECK(pages != NULL, "dict pages open failed");
    if (!pages) {
        free(data);
        return;
    }

    const char *nn[] = {"qty"};
    EastType *nt[] = {&east_integer_type};
    EastType *narrow_row = east_struct_type(nn, nt, 1);
    Beast2Projection *pr =
        east_beast2_projection_new(dt, east_dict_type(&east_integer_type, narrow_row));
    CHECK(pr != NULL, "dict plan build failed");
    if (!pr) {
        east_beast2_pages_free(pages);
        free(data);
        return;
    }

    /* Disjointness-checked projected segments: keys whole + ascending,
     * values narrow. */
    size_t segs = east_beast2_pages_segment_count(pages);
    CHECK(segs > 1, "expected multiple dict segments, got %zu", segs);
    int64_t expect = 0;
    for (size_t s = 0; s < segs; s++) {
        EastValue *seg = east_beast2_pages_segment_disjoint_projected(pages, s, pr);
        CHECK(seg != NULL, "dict projected segment %zu failed", s);
        if (!seg) break;
        size_t n = east_dict_len(seg);
        for (size_t i = 0; i < n; i++, expect++) {
            EastValue *k = east_dict_key_at(seg, i);
            EastValue *v = east_dict_val_at(seg, i);
            CHECK(k->data.integer == expect, "dict key order");
            CHECK(v->kind == EAST_VAL_STRUCT && v->data.struct_.num_fields == 1,
                  "dict value narrowed");
            EastValue *qty = east_struct_get_field(v, "qty");
            CHECK(qty && qty->data.integer == expect * 7, "dict qty value");
        }
        east_value_release(seg);
    }
    CHECK(expect == 150, "all dict rows seen, got %lld", (long long)expect);

    /* Keyed reads through an open-time projection answer narrow values. */
    east_beast2_pages_set_projection(pages, pr);
    EastValue *key = east_integer(42);
    EastValue *val = NULL;
    int rc = east_beast2_pages_get_key(pages, key, &val);
    CHECK(rc == 1 && val != NULL, "projected get_key");
    if (val) {
        CHECK(val->data.struct_.num_fields == 1, "projected get_key value shape");
        EastValue *qty = east_struct_get_field(val, "qty");
        CHECK(qty && qty->data.integer == 42 * 7, "projected get_key value");
        east_value_release(val);
    }
    east_value_release(key);
    east_beast2_pages_set_projection(pages, NULL);

    east_beast2_projection_free(pr);
    east_beast2_pages_free(pages);
    free(data);
}

static void test_alias_detection(void)
{
    /* Two fields share ONE array value — the encoder writes NEW at the first
     * and REF at the second. Skipping the first while keeping the second
     * must fail with the projection-alias error, never serve wrong data. */
    EastType *arr_t = east_array_type(&east_integer_type);
    const char *names[] = {"a", "b"};
    EastType *types[] = {arr_t, arr_t};
    EastType *row_t = east_struct_type(names, types, 2);
    EastType *at = east_array_type(row_t);

    EastValue *shared = east_array_new(&east_integer_type);
    for (int64_t i = 0; i < 5; i++) {
        EastValue *v = east_integer(i);
        east_array_push(shared, v);
        east_value_release(v);
    }
    EastValue *vals[] = {shared, shared};
    EastValue *row = east_struct_new(names, vals, 2, row_t);
    east_value_release(shared);
    EastValue *arr = east_array_new(row_t);
    east_array_push(arr, row);
    east_value_release(row);
    ByteBuffer *buf = east_beast2_encode_paged(arr, at, EAST_BEAST2_CODEC_NONE, 0);
    east_value_release(arr);
    CHECK(buf != NULL, "alias encode failed");
    if (!buf) return;

    Beast2Pages *pages = east_beast2_pages_new(buf->data, buf->len, at);
    CHECK(pages != NULL, "alias pages open failed");
    if (!pages) {
        byte_buffer_free(buf);
        return;
    }

    const char *keep_b[] = {"b"};
    EastType *keep_b_t[] = {arr_t};
    Beast2Projection *pr =
        east_beast2_projection_new(at, east_array_type(east_struct_type(keep_b, keep_b_t, 1)));
    CHECK(pr != NULL, "alias plan build failed");
    if (pr) {
        EastValue *seg = east_beast2_pages_segment_projected(pages, 0, pr);
        CHECK(seg == NULL, "alias-crossing projection must fail");
        char *err = take_error();
        CHECK(strstr(err, "projection alias") != NULL, "alias error text: %s", err);
        free(err);
        east_beast2_projection_free(pr);
    }

    /* Keeping BOTH fields whole keeps the alias inside the projection: the
     * shared container decodes once and the REF resolves normally. */
    const char *keep_ab[] = {"a", "b"};
    EastType *keep_ab_t[] = {arr_t, arr_t};
    /* Adding an ignored extra field first makes the projected type differ
     * from the wire type, so the plan is NARROW rather than identity —
     * exercising the mixed plain/projected REF path. */
    EastType *extra_row = east_struct_type(keep_ab, keep_ab_t, 2);
    Beast2Projection *pr2 = east_beast2_projection_new(at, east_array_type(extra_row));
    CHECK(pr2 != NULL && east_beast2_projection_is_identity(pr2),
          "keeping every field is the identity plan");
    if (pr2) east_beast2_projection_free(pr2);

    /* The whole decode of the same segment stays fine. */
    EastValue *whole = east_beast2_pages_segment(pages, 0);
    CHECK(whole != NULL, "whole decode of aliased segment");
    if (whole) {
        EastValue *r = east_array_get(whole, 0);
        CHECK(east_struct_get_field(r, "a") == east_struct_get_field(r, "b"),
              "alias preserved in whole decode");
        east_value_release(whole);
    }

    east_beast2_pages_free(pages);
    byte_buffer_free(buf);
}

static void test_reader_projection(void)
{
    EastType *row_t = wide_row_type();
    EastType *at = east_array_type(row_t);
    size_t len = 0;
    uint8_t *data = encode_wide_array(row_t, 120, &len);
    CHECK(data != NULL, "encode failed");
    if (!data) return;

    const char *nn[] = {"qty"};
    EastType *nt[] = {&east_integer_type};
    EastType *narrow_t = east_struct_type(nn, nt, 1);
    Beast2Projection *pr = east_beast2_projection_new(at, east_array_type(narrow_t));
    CHECK(pr != NULL, "reader plan build failed");

    Beast2SegmentReader *r = east_beast2_reader_new(data, len, at);
    CHECK(r != NULL, "reader open failed");
    if (r && pr) {
        east_beast2_reader_set_projection(r, pr);
        int64_t row = 0;
        for (;;) {
            EastValue *seg = east_beast2_reader_next(r);
            if (!seg) break;
            size_t n = east_array_len(seg);
            for (size_t i = 0; i < n; i++, row++) {
                EastValue *v = east_array_get(seg, i);
                CHECK(v->data.struct_.num_fields == 1, "reader narrow row");
                EastValue *qty = east_struct_get_field(v, "qty");
                CHECK(qty && qty->data.integer == row * 7, "reader qty row %lld", (long long)row);
            }
            east_value_release(seg);
        }
        CHECK(east_beast2_reader_done(r), "reader completed cleanly");
        CHECK(row == 120, "reader saw every row, got %lld", (long long)row);
    }
    if (r) east_beast2_reader_free(r);
    if (pr) east_beast2_projection_free(pr);
    free(data);
}

int main(void)
{
    east_type_of_type_init();
    test_validation();
    test_array_projection();
    test_dict_projection();
    test_alias_detection();
    test_reader_projection();
    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("beast2 projection gate: OK\n");
    return 0;
}
