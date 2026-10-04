/*
 * The pager's cache gate (#1129).
 *
 * A pager keeps the segments its element and keyed reads decode in a cache of
 * its own, counted in decoded weight (libs/east/src/serialization/beast2/v5/
 * SPEC.md, "The pager's cache"). This gate holds:
 *
 *   1. the weights: every case of the shared fixture
 *      (libs/east/test/fixtures/paged-weights.beast2), each the one element of
 *      an indexed Array, weighs in the cache what the fixture says, as it does
 *      in TypeScript's and east-py's; and on a 64-bit build the weight of a
 *      value that holds no function is what the decode built — its nodes
 *      exactly the value slab's growth over the read, the rest the string,
 *      blob and slot bytes a walk of the decoded value finds;
 *   2. root Sets and Dicts on each side of 256 entries, and a projected read,
 *      which counts only the fields it keeps;
 *   3. least recently used, within a budget of three segments' weight: the
 *      decodes, hits and evictions of a model, the newest segment always
 *      kept, one at a budget of 1, and a smaller budget evicting at once;
 *   4. drop-behind: keyed, batched and row reads in key order hold two
 *      segments and decode each once; segments cached before a run, or past
 *      what it reads, survive it; a backward read ends a run;
 *   5. a projection, or a hydration, empties the cache.
 *
 * Run under ASan/LSan (run_leak_check.sh's build-asan config) for the cache's
 * entry pool and recency list.
 *
 * Usage: test_beast2_pages_cache [fixtures-dir]
 *   (default: libs/east/test/fixtures, where CMake says this source lives)
 */
#include <east/east.h>
#include <east/gc.h>
#include <east/type_of_type.h>
#include <east/value_slab.h>

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef EAST_TEST_FIXTURES_DIR
#define EAST_TEST_FIXTURES_DIR "../../../east/test/fixtures"
#endif

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

/* The weight of the one-element Array each fixture case's blob holds, without
 * its element: an Array's node and its one slot. */
#define SEGMENT_OF_ONE (104 + 8)

/* An Array<Integer> segment of 8: its node and slots, and 8 Integers. */
#define ARRAY_SEGMENT (104 + 8 * 8 + 8 * 16)

/* A Dict<Integer, String> segment of 8 "row-N" entries: its node and slots,
 * and 8 Integer keys and 8 String values held in their nodes. */
#define DICT_SEGMENT (104 + 8 * 16 + 8 * (16 + 72))

static ByteBuffer *read_file(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    ByteBuffer *buf = byte_buffer_new(len > 0 ? (size_t)len : 1);
    buf->len = fread(buf->data, 1, (size_t)len, f);
    fclose(f);
    return buf;
}

/* A self-contained, indexed blob of `value` — an Array, Set or Dict — whose
 * segments hold `per_segment` elements each: the test's geometry, not the cut
 * rule's. */
static ByteBuffer *encode_in_segments(EastValue *value, EastType *type, size_t per_segment)
{
    Beast2StreamWriter *w = east_beast2_writer_new(type, EAST_BEAST2_CODEC_DEFLATE, true, true);
    if (!w) return NULL;
    size_t n = type->kind == EAST_TYPE_ARRAY ? east_array_len(value)
               : type->kind == EAST_TYPE_SET ? east_set_len(value)
                                             : east_dict_len(value);
    bool ok = true;
    for (size_t i = 0; ok && i < n; i += per_segment) {
        size_t end = i + per_segment < n ? i + per_segment : n;
        EastValue *batch = type->kind == EAST_TYPE_ARRAY ? east_array_new(type->data.element)
                           : type->kind == EAST_TYPE_SET
                               ? east_set_new(type->data.element)
                               : east_dict_new(type->data.dict.key, type->data.dict.value);
        for (size_t k = i; k < end; k++) {
            if (type->kind == EAST_TYPE_ARRAY)
                east_array_push(batch, east_array_get(value, k));
            else if (type->kind == EAST_TYPE_SET)
                east_set_insert(batch, east_set_at(value, k));
            else
                east_dict_set(batch, east_dict_key_at(value, k), east_dict_val_at(value, k));
        }
        ok = east_beast2_writer_write(w, batch);
        east_value_release(batch);
    }
    ok = ok && east_beast2_writer_finish(w);
    ByteBuffer *buf = ok ? east_beast2_writer_take(w) : NULL;
    east_beast2_writer_free(w);
    return buf;
}

/* An Array<Integer> of 0..n-1. */
static EastValue *int_array(size_t n)
{
    EastValue *arr = east_array_new(&east_integer_type);
    for (size_t i = 0; i < n; i++) {
        EastValue *v = east_integer((int64_t)i);
        east_array_push(arr, v);
        east_value_release(v);
    }
    return arr;
}

/* A Dict<Integer, String> of i -> "row-i" for i in 0..n-1. */
static EastValue *row_dict(size_t n)
{
    EastValue *dict = east_dict_new(&east_integer_type, &east_string_type);
    for (size_t i = 0; i < n; i++) {
        char name[32];
        snprintf(name, sizeof(name), "row-%zu", i);
        EastValue *k = east_integer((int64_t)i);
        EastValue *v = east_string(name);
        east_dict_set(dict, k, v);
        east_value_release(k);
        east_value_release(v);
    }
    return dict;
}

/* A pager over a fresh Dict<Integer, String> of `segments` segments of 8. */
static Beast2Pages *dict_pager(size_t segments, ByteBuffer **blob_out)
{
    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    EastValue *dict = row_dict(segments * 8);
    *blob_out = encode_in_segments(dict, dt, 8);
    east_value_release(dict);
    return *blob_out ? east_beast2_pages_new((*blob_out)->data, (*blob_out)->len, dt) : NULL;
}

static Beast2PagesCacheStats cache_stats(Beast2Pages *p)
{
    Beast2PagesCacheStats s;
    east_beast2_pages_cache_stats(p, &s);
    return s;
}

static size_t decoded(Beast2Pages *p)
{
    size_t n = 0;
    east_beast2_pages_stats(p, &n, NULL);
    return n;
}

/* A keyed read of `key`, which must be present. */
static void read_key(Beast2Pages *p, int64_t key)
{
    EastValue *k = east_integer(key);
    EastValue *out = NULL;
    CHECK(east_beast2_pages_get_key(p, k, &out) == 1, "key %lld missing", (long long)key);
    if (out) east_value_release(out);
    east_value_release(k);
}

/* ------------------------------------------------------------------ */
/*  The slab oracle                                                     */
/* ------------------------------------------------------------------ */

/* The containers a walk has met, by identity: one met again through a REF was
 * built once, and counts once. */
typedef struct {
    const EastValue **at;
    size_t n, cap;
} Seen;

static bool seen_first(Seen *seen, const EastValue *v)
{
    for (size_t i = 0; i < seen->n; i++)
        if (seen->at[i] == v) return false;
    if (seen->n == seen->cap) {
        seen->cap = seen->cap ? seen->cap * 2 : 16;
        seen->at = realloc(seen->at, seen->cap * sizeof(*seen->at));
    }
    seen->at[seen->n++] = v;
    return true;
}

/* What a decode of `v` built: the bytes of its nodes, by their size classes,
 * and what it holds beside them — a long string's bytes, a blob's, a Vector's
 * or Matrix's elements, and its containers' slots. A walk of the decoded
 * value, apart from the counting the decoder does as it builds. It does not
 * walk into a function, whose IR and captures the decode built too, and sets
 * *function when it meets one. */
static void walk(EastValue *v, Seen *seen, size_t *nodes, size_t *beside, bool *function)
{
    if (!v || v->ref_count < 0) return; /* the null value, or a case the type shares */
    if ((v->kind == EAST_VAL_ARRAY || v->kind == EAST_VAL_SET || v->kind == EAST_VAL_DICT ||
         v->kind == EAST_VAL_REF) &&
        !seen_first(seen, v))
        return;
    *nodes += east_value_alloc_size(v->kind);
    switch (v->kind) {
    case EAST_VAL_STRING:
        if (v->data.string.len > EAST_STRING_INLINE_CAP) *beside += v->data.string.len + 1;
        break;
    case EAST_VAL_BLOB:
        *beside += v->data.blob.len;
        break;
    case EAST_VAL_ARRAY:
        *beside += 8 * v->data.array.len;
        for (size_t i = 0; i < v->data.array.len; i++)
            walk(v->data.array.items[i], seen, nodes, beside, function);
        break;
    case EAST_VAL_SET: {
        size_t n = east_set_len(v);
        *beside += (n <= EAST_SMALL_COLLECTION_MAX ? 8 : 16) * n;
        for (size_t i = 0; i < n; i++)
            walk(east_set_at(v, i), seen, nodes, beside, function);
        break;
    }
    case EAST_VAL_DICT: {
        size_t n = east_dict_len(v);
        *beside += (n <= EAST_SMALL_COLLECTION_MAX ? 16 : 32) * n;
        for (size_t i = 0; i < n; i++) {
            walk(east_dict_key_at(v, i), seen, nodes, beside, function);
            walk(east_dict_val_at(v, i), seen, nodes, beside, function);
        }
        break;
    }
    case EAST_VAL_STRUCT:
        *beside += 8 * v->data.struct_.num_fields;
        for (size_t i = 0; i < v->data.struct_.num_fields; i++)
            walk(v->data.struct_.field_values[i], seen, nodes, beside, function);
        break;
    case EAST_VAL_VARIANT:
        walk(v->data.variant.value, seen, nodes, beside, function);
        break;
    case EAST_VAL_REF:
        walk(v->data.ref.value, seen, nodes, beside, function);
        break;
    case EAST_VAL_VECTOR: {
        EastType *et = v->data.vector.elem_type;
        *beside += v->data.vector.len * (et && et->kind == EAST_TYPE_BOOLEAN ? 1 : 8);
        break;
    }
    case EAST_VAL_MATRIX: {
        EastType *et = v->data.matrix.elem_type;
        *beside += v->data.matrix.rows * v->data.matrix.cols *
                   (et && et->kind == EAST_TYPE_BOOLEAN ? 1 : 8);
        break;
    }
    case EAST_VAL_FUNCTION:
        *function = true;
        break;
    default:
        break;
    }
}

/* The weights are east-c's layout on a 64-bit build: only there are they the
 * slab's own accounting. */
static bool slab_is_the_weight(void)
{
    return sizeof(void *) == 8;
}

/* ------------------------------------------------------------------ */
/*  1. The shared fixture                                               */
/* ------------------------------------------------------------------ */

static void test_fixture_weights(const char *dir)
{
    char path[1200];
    snprintf(path, sizeof(path), "%s/paged-weights.beast2", dir);
    ByteBuffer *file = read_file(path);
    CHECK(file != NULL, "%s is missing (run `make paged-weights` in libs/east)", path);
    if (!file) return;
    EastValue *cases = east_beast2_decode_auto(file->data, file->len);
    CHECK(cases && cases->kind == EAST_VAL_ARRAY, "paged-weights.beast2 does not decode: %s",
          east_builtin_get_error());
    size_t checked = 0, oracled = 0;
    for (size_t i = 0; cases && i < east_array_len(cases); i++) {
        EastValue *c = east_array_get(cases, i);
        const char *name = east_struct_get_field(c, "name")->data.string.data;
        EastValue *blob = east_struct_get_field(c, "blob");
        int64_t weight = east_struct_get_field(c, "weight")->data.integer;

        EastType *type = east_beast2_extract_type(blob->data.blob.data, blob->data.blob.len);
        Beast2Pages *p =
            type ? east_beast2_pages_new(blob->data.blob.data, blob->data.blob.len, type) : NULL;
        CHECK(p != NULL, "%s: its blob does not open: %s", name, east_builtin_get_error());
        if (!p) {
            if (type) east_type_release(type);
            continue;
        }
        east_gc_collect_full();
        size_t before = east_value_slab_stats().bytes_live;
        EastValue *item = east_beast2_pages_element(p, 0);
        size_t grown = east_value_slab_stats().bytes_live - before;
        CHECK(item != NULL, "%s: its element does not read: %s", name, east_builtin_get_error());
        Beast2PagesCacheStats s = cache_stats(p);
        CHECK(s.segments == 1 && s.weight == (size_t)(SEGMENT_OF_ONE + weight),
              "%s: the cache weighs its segment %zu, not %lld", name, s.weight,
              (long long)(SEGMENT_OF_ONE + weight));
        checked++;

        /* A function's IR and captures are slab nodes its constant weight
         * leaves out, so a value holding one is held to the fixture alone. */
        if (item && slab_is_the_weight()) {
            Seen seen = {0};
            size_t nodes = 104; /* the segment's Array */
            size_t beside = 8;  /* and its one slot */
            bool function = false;
            walk(item, &seen, &nodes, &beside, &function);
            free(seen.at);
            if (!function) {
                CHECK(grown == nodes,
                      "%s: the read put %zu bytes of nodes in the slab, a walk finds %zu", name,
                      grown, nodes);
                CHECK(s.weight == grown + beside,
                      "%s: the cache counts %zu; the slab's %zu and the walk's %zu beside are %zu",
                      name, s.weight, grown, beside, grown + beside);
                oracled++;
            }
        }
        if (item) east_value_release(item);
        east_beast2_pages_free(p);
        east_type_release(type);
    }
    CHECK(checked >= 30, "the fixture holds %zu cases, not every kind", checked);
    printf("    %zu cases weighed, %zu held to the slab\n", checked, oracled);
    if (cases) east_value_release(cases);
    byte_buffer_free(file);
}

/* ------------------------------------------------------------------ */
/*  2. Root containers, and a projected read                            */
/* ------------------------------------------------------------------ */

/* A root Set or Dict of `n` Integers in one segment: what one keyed read of it
 * caches, held to the table and, on a 64-bit build, to the slab. */
static void check_root(bool dict, size_t n)
{
    EastType *type = dict ? east_dict_type(&east_integer_type, &east_integer_type)
                          : east_set_type(&east_integer_type);
    EastValue *value = dict ? east_dict_new(&east_integer_type, &east_integer_type)
                            : east_set_new(&east_integer_type);
    for (size_t i = 0; i < n; i++) {
        EastValue *k = east_integer((int64_t)i);
        if (dict)
            east_dict_set(value, k, k);
        else
            east_set_insert(value, k);
        east_value_release(k);
    }
    ByteBuffer *blob = encode_in_segments(value, type, n);
    east_value_release(value);
    Beast2Pages *p = blob ? east_beast2_pages_new(blob->data, blob->len, type) : NULL;
    CHECK(p && east_beast2_pages_segment_count(p) == 1,
          "a root of %zu does not open as one segment", n);
    if (!p) {
        if (blob) byte_buffer_free(blob);
        return;
    }
    /* The fence a keyed read searches is decoded and kept apart from the cache:
     * decode it first, so the slab grows by the segment alone. */
    EastValue *fence = east_beast2_pages_fence(p, 0);
    if (fence) east_value_release(fence);
    east_gc_collect_full();
    size_t before = east_value_slab_stats().bytes_live;
    read_key(p, 5);
    size_t grown = east_value_slab_stats().bytes_live - before;
    size_t slot = dict ? (n <= 256 ? 16 : 32) : (n <= 256 ? 8 : 16);
    size_t elements = (dict ? 32 : 16) * n;
    Beast2PagesCacheStats s = cache_stats(p);
    CHECK(s.weight == 104 + slot * n + elements, "a root %s of %zu weighs %zu, not %zu",
          dict ? "Dict" : "Set", n, s.weight, 104 + slot * n + elements);
    if (slab_is_the_weight())
        CHECK(grown == 104 + elements,
              "a root %s of %zu put %zu bytes of nodes in the slab, not %zu", dict ? "Dict" : "Set",
              n, grown, 104 + elements);
    east_beast2_pages_free(p);
    byte_buffer_free(blob);
}

static void test_root_containers_and_projection(void)
{
    check_root(false, 256);
    check_root(false, 257);
    check_root(true, 256);
    check_root(true, 257);

    /* A Dict<Integer, Struct{a: Integer, b: String}> of 8, read through a
     * projection to {a}: the struct of one field kept, and nothing of b. */
    EastType *row = east_struct_type((const char *[]){"a", "b"},
                                     (EastType *[]){&east_integer_type, &east_string_type}, 2);
    EastType *narrow =
        east_struct_type((const char *[]){"a"}, (EastType *[]){&east_integer_type}, 1);
    EastType *wire = east_dict_type(&east_integer_type, row);
    EastValue *dict = east_dict_new(&east_integer_type, row);
    for (size_t i = 0; i < 8; i++) {
        EastValue *k = east_integer((int64_t)i);
        EastValue *b = east_string("a string of no more than 47 bytes");
        EastValue *fields[] = {k, b};
        EastValue *v = east_struct_new((const char *[]){"a", "b"}, fields, 2, row);
        east_dict_set(dict, k, v);
        east_value_release(v);
        east_value_release(b);
        east_value_release(k);
    }
    ByteBuffer *blob = encode_in_segments(dict, wire, 8);
    east_value_release(dict);
    Beast2Pages *p = blob ? east_beast2_pages_new(blob->data, blob->len, wire) : NULL;
    Beast2Projection *pr =
        east_beast2_projection_new(wire, east_dict_type(&east_integer_type, narrow));
    CHECK(p && pr, "the projected pager does not open: %s", east_builtin_get_error());
    if (p && pr) {
        east_beast2_pages_set_projection(p, pr);
        EastValue *fence = east_beast2_pages_fence(p, 0);
        if (fence) east_value_release(fence);
        east_gc_collect_full();
        size_t before = east_value_slab_stats().bytes_live;
        read_key(p, 3);
        size_t grown = east_value_slab_stats().bytes_live - before;
        /* The Dict of 8 (104 + 16 each), and 8 entries of an Integer key and a
         * struct of one Integer field (104 + 8 + 16). */
        size_t want = 104 + 16 * 8 + 8 * (16 + 104 + 8 + 16);
        CHECK(cache_stats(p).weight == want, "a projected segment weighs %zu, not %zu",
              cache_stats(p).weight, want);
        if (slab_is_the_weight())
            CHECK(grown == 104 + 8 * (16 + 104 + 16),
                  "a projected read put %zu bytes of nodes in the slab, not %d", grown,
                  104 + 8 * (16 + 104 + 16));
    }
    if (p) east_beast2_pages_free(p);
    if (pr) east_beast2_projection_free(pr);
    if (blob) byte_buffer_free(blob);
}

/* ------------------------------------------------------------------ */
/*  3. Least recently used                                              */
/* ------------------------------------------------------------------ */

static void test_least_recently_used(void)
{
    EastType *at = east_array_type(&east_integer_type);
    EastValue *arr = int_array(96);
    ByteBuffer *blob = encode_in_segments(arr, at, 8);
    east_value_release(arr);
    Beast2Pages *p = blob ? east_beast2_pages_new(blob->data, blob->len, at) : NULL;
    CHECK(p && east_beast2_pages_segment_count(p) == 12, "the Array does not open as 12 segments");
    if (!p) {
        if (blob) byte_buffer_free(blob);
        return;
    }
    if (!getenv("EAST_PAGED_CACHE_BYTES"))
        CHECK(cache_stats(p).budget == (size_t)256 * 1024 * 1024, "the default budget is %zu",
              cache_stats(p).budget);
    east_beast2_pages_set_cache_budget(p, 3 * ARRAY_SEGMENT);

    /* Rows of these segments, in an order no four misses of which run in key
     * order, beside a model: the three most recently used, newest first. */
    static const size_t order[] = {5, 0, 9, 5, 2, 11, 0, 7, 9, 3, 5, 10, 1, 9, 6, 0, 6, 11};
    size_t model[3];
    size_t held = 0, misses = 0, hits = 0, evictions = 0;
    for (size_t r = 0; r < sizeof(order) / sizeof(order[0]); r++) {
        size_t s = order[r];
        size_t at_index = held;
        for (size_t k = 0; k < held; k++)
            if (model[k] == s) at_index = k;
        if (at_index < held) {
            hits++;
            memmove(model + 1, model, at_index * sizeof(size_t));
        } else {
            misses++;
            if (held == 3) {
                evictions++;
                held--;
            }
            memmove(model + 1, model, held * sizeof(size_t));
            held++;
        }
        model[0] = s;
        EastValue *item = east_beast2_pages_element(p, s * 8 + r % 8);
        CHECK(item && item->data.integer == (int64_t)(s * 8 + r % 8), "row %zu reads wrong",
              s * 8 + r % 8);
        if (item) east_value_release(item);
    }
    Beast2PagesCacheStats s = cache_stats(p);
    CHECK(decoded(p) == misses && s.hits == hits && s.evictions == evictions,
          "decoded %zu, hit %zu, evicted %zu; the model %zu, %zu, %zu", decoded(p), s.hits,
          s.evictions, misses, hits, evictions);
    CHECK(s.dropped_behind == 0, "a read order with no run dropped %zu behind", s.dropped_behind);
    CHECK(s.segments == 3 && s.weight == 3 * ARRAY_SEGMENT && s.peak_weight == 3 * ARRAY_SEGMENT,
          "the cache holds %zu segments weighing %zu (peak %zu), not 3 of %d", s.segments, s.weight,
          s.peak_weight, 3 * ARRAY_SEGMENT);
    /* What the model holds is what the cache does: each reads as a hit. */
    for (size_t k = 0; k < held; k++) {
        EastValue *item = east_beast2_pages_element(p, model[k] * 8);
        if (item) east_value_release(item);
    }
    CHECK(cache_stats(p).hits == hits + held && decoded(p) == misses,
          "the model's segments are not the ones cached");

    /* A smaller budget evicts at once, keeping the newest; at 1, one segment
     * stays, over budget, and is read again as a hit. */
    size_t evicted = cache_stats(p).evictions;
    east_beast2_pages_set_cache_budget(p, 1);
    s = cache_stats(p);
    CHECK(s.segments == 1 && s.evictions == evicted + 2 && s.weight == ARRAY_SEGMENT,
          "a budget of 1 left %zu segments (%zu evicted)", s.segments, s.evictions - evicted);
    size_t before = decoded(p);
    for (int pass = 0; pass < 2; pass++) {
        EastValue *item = east_beast2_pages_element(p, 4 * 8);
        if (item) east_value_release(item);
    }
    CHECK(decoded(p) == before + 1 && cache_stats(p).segments == 1,
          "at a budget of 1, two reads of one segment decoded %zu", decoded(p) - before);
    EastValue *item = east_beast2_pages_element(p, 8 * 8);
    if (item) east_value_release(item);
    item = east_beast2_pages_element(p, 4 * 8);
    if (item) east_value_release(item);
    CHECK(decoded(p) == before + 3 && cache_stats(p).segments == 1,
          "at a budget of 1, segment 4 survived segment 8 (%zu decoded)", decoded(p) - before);
    east_beast2_pages_free(p);
    byte_buffer_free(blob);
}

/* ------------------------------------------------------------------ */
/*  4. Drop-behind                                                      */
/* ------------------------------------------------------------------ */

static void test_drop_behind(void)
{
    /* Keyed reads in key order: every key of 20 segments. Each segment decodes
     * once; from the fourth miss on, the run keeps the segment it is in and the
     * one before. */
    ByteBuffer *blob = NULL;
    Beast2Pages *p = dict_pager(20, &blob);
    CHECK(p != NULL, "the Dict does not open");
    if (p) {
        for (int64_t k = 0; k < 160; k++)
            read_key(p, k);
        Beast2PagesCacheStats s = cache_stats(p);
        CHECK(decoded(p) == 20 && s.hits == 140, "keyed reads in order decoded %zu, hit %zu",
              decoded(p), s.hits);
        CHECK(s.dropped_behind == 18 && s.segments == 2 && s.weight == 2 * DICT_SEGMENT,
              "keyed reads in order dropped %zu and hold %zu segments (%zu)", s.dropped_behind,
              s.segments, s.weight);
        CHECK(s.peak_weight == 3 * DICT_SEGMENT, "keyed reads in order peaked at %zu, not %d",
              s.peak_weight, 3 * DICT_SEGMENT);
        east_beast2_pages_free(p);
    }
    byte_buffer_free(blob);

    /* A batched read of every key is one forward merge: the same run. */
    p = dict_pager(20, &blob);
    if (p) {
        EastValue *keys = east_set_new(&east_integer_type);
        for (int64_t k = 0; k < 160; k++) {
            EastValue *key = east_integer(k);
            east_set_insert(keys, key);
            east_value_release(key);
        }
        EastValue *found = east_beast2_pages_get_keys(p, keys, NULL);
        CHECK(found && east_dict_len(found) == 160, "the batched read found %zu",
              found ? east_dict_len(found) : 0);
        if (found) east_value_release(found);
        east_value_release(keys);
        Beast2PagesCacheStats s = cache_stats(p);
        CHECK(decoded(p) == 20 && s.dropped_behind == 18 && s.segments == 2,
              "the batched read decoded %zu, dropped %zu, holds %zu", decoded(p), s.dropped_behind,
              s.segments);
        east_beast2_pages_free(p);
    }
    byte_buffer_free(blob);

    /* Row reads of an Array in order. */
    EastType *at = east_array_type(&east_integer_type);
    EastValue *arr = int_array(96);
    blob = encode_in_segments(arr, at, 8);
    east_value_release(arr);
    p = blob ? east_beast2_pages_new(blob->data, blob->len, at) : NULL;
    if (p) {
        for (size_t row = 0; row < 96; row++) {
            EastValue *item = east_beast2_pages_element(p, row);
            if (item) east_value_release(item);
        }
        Beast2PagesCacheStats s = cache_stats(p);
        CHECK(decoded(p) == 12 && s.dropped_behind == 10 && s.segments == 2,
              "rows in order decoded %zu, dropped %zu, hold %zu", decoded(p), s.dropped_behind,
              s.segments);
        east_beast2_pages_free(p);
    }
    byte_buffer_free(blob);

    /* A random working set survives a run in key order over the same input:
     * segments 15, 2 and 7 are read first, then every key of 5 through 12. The
     * run reads 7 as a hit, skips from 6 to 8, and drops only what it decoded
     * itself: 5, 6, 8, 9 and 10. */
    p = dict_pager(20, &blob);
    if (p) {
        read_key(p, 15 * 8);
        read_key(p, 2 * 8);
        read_key(p, 7 * 8);
        for (int64_t k = 5 * 8; k < 13 * 8; k++)
            read_key(p, k);
        Beast2PagesCacheStats s = cache_stats(p);
        CHECK(decoded(p) == 10 && s.dropped_behind == 5 && s.segments == 5,
              "the run past a working set decoded %zu, dropped %zu, holds %zu", decoded(p),
              s.dropped_behind, s.segments);
        size_t hits = s.hits;
        read_key(p, 15 * 8 + 1);
        read_key(p, 2 * 8 + 1);
        read_key(p, 7 * 8 + 1);
        read_key(p, 12 * 8 + 1);
        CHECK(decoded(p) == 10 && cache_stats(p).hits == hits + 4,
              "the working set did not survive the run (%zu decoded)", decoded(p));
        east_beast2_pages_free(p);
    }
    byte_buffer_free(blob);

    /* A backward read ends the run: after keys of segments 0 to 9, a key in
     * segment 3 starts a new one, which drops nothing until its fourth miss. */
    p = dict_pager(20, &blob);
    if (p) {
        for (int64_t k = 0; k < 10 * 8; k++)
            read_key(p, k);
        CHECK(cache_stats(p).dropped_behind == 8, "the first run dropped %zu",
              cache_stats(p).dropped_behind);
        read_key(p, 3 * 8);
        read_key(p, 4 * 8);
        read_key(p, 5 * 8);
        Beast2PagesCacheStats s = cache_stats(p);
        CHECK(s.dropped_behind == 8 && s.segments == 5,
              "three misses after a backward read dropped %zu and hold %zu", s.dropped_behind - 8,
              s.segments);
        read_key(p, 6 * 8);
        s = cache_stats(p);
        CHECK(s.dropped_behind == 10 && s.segments == 4,
              "the new run's fourth miss dropped %zu and holds %zu", s.dropped_behind - 8,
              s.segments);
        east_beast2_pages_free(p);
    }
    byte_buffer_free(blob);
}

/* ------------------------------------------------------------------ */
/*  5. What empties the cache                                           */
/* ------------------------------------------------------------------ */

static void test_projection_and_hydration_empty_it(void)
{
    ByteBuffer *blob = NULL;
    Beast2Pages *p = dict_pager(4, &blob);
    if (p) {
        read_key(p, 1);
        read_key(p, 9);
        CHECK(cache_stats(p).segments == 2, "two keyed reads cached %zu", cache_stats(p).segments);
        east_beast2_pages_set_projection(p, NULL);
        Beast2PagesCacheStats s = cache_stats(p);
        CHECK(s.segments == 0 && s.weight == 0, "a projection left %zu segments (%zu)", s.segments,
              s.weight);
        size_t before = decoded(p);
        read_key(p, 1);
        CHECK(decoded(p) == before + 1 && cache_stats(p).segments == 1,
              "a read after a projection was not a miss");
        east_beast2_pages_free(p);
    }
    byte_buffer_free(blob);

    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    EastValue *dict = row_dict(32);
    ByteBuffer *bytes = encode_in_segments(dict, dt, 8);
    east_value_release(dict);
    uint8_t *data = bytes ? malloc(bytes->len) : NULL;
    if (data) memcpy(data, bytes->data, bytes->len);
    EastValue *paged = data ? east_beast2_open_paged(data, bytes->len, dt) : NULL;
    CHECK(paged != NULL, "the paged value does not open");
    if (paged) {
        EastValue *key = east_integer(17);
        CHECK(east_dict_has(paged, key), "a keyed read of the paged value missed");
        east_value_release(key);
        CHECK(cache_stats(paged->data.paged.pages).segments == 1, "the keyed read cached nothing");
        CHECK(east_paged_hydrated(paged) != NULL, "the hydration failed");
        CHECK(cache_stats(paged->data.paged.pages).segments == 0,
              "a hydration left the cache's segments");
        east_value_release(paged);
    } else {
        free(data);
    }
    if (bytes) byte_buffer_free(bytes);

    Beast2PagesCacheStats none;
    east_beast2_pages_cache_stats(NULL, &none);
    CHECK(none.segments == 0 && none.weight == 0 && none.budget == 0,
          "no pager's statistics are not zero");
}

int main(int argc, char **argv)
{
    const char *dir = argc > 1 ? argv[1] : EAST_TEST_FIXTURES_DIR;
    east_type_of_type_init();
    /* The fixture's function decodes against the current registries. */
    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    PlatformRegistry *platform = platform_registry_new();
    east_set_thread_context(platform, builtins);

    struct {
        const char *name;
        void (*run)(void);
    } tests[] = {
        {"root containers and a projection", test_root_containers_and_projection},
        {"least recently used", test_least_recently_used},
        {"drop-behind", test_drop_behind},
        {"projection and hydration empty it", test_projection_and_hydration_empty_it},
    };
    int before = failures;
    printf("[>] the shared fixture's weights\n");
    test_fixture_weights(dir);
    printf("[%c] the shared fixture's weights\n", failures == before ? '+' : 'x');
    for (size_t i = 0; i < sizeof(tests) / sizeof(tests[0]); i++) {
        before = failures;
        printf("[>] %s\n", tests[i].name);
        tests[i].run();
        printf("[%c] %s\n", failures == before ? '+' : 'x', tests[i].name);
    }

    east_gc_collect_full();
    platform_registry_free(platform);
    builtin_registry_free(builtins);
    if (failures > 0) {
        fprintf(stderr, "pager cache gate: %d check(s) failed\n", failures);
        return 1;
    }
    printf("pager cache gate: all checks passed\n");
    return 0;
}
